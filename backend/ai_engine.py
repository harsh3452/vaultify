import os
import io
import re
import json
import base64
import time
from PIL import Image
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

LM_STUDIO_URL  = os.getenv("LM_STUDIO_URL", "http://localhost:1234/v1")
MAX_AI_EDGE    = 2000

# Gemini fallback — used only in /retry-pending, never on fresh uploads
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL   = os.getenv("GEMINI_MODEL", "gemini-2.0-flash-lite")

PROMPT = """You are a KYC document parser for Indian ID documents.
The image may be a physical card photo, a PDF screenshot, a scanned letter, or a screenshot from a PDF viewer — all are valid inputs.
If the image contains multiple panels or copies of the same document, extract from whichever panel is most legible.

Step 1 — Identify document_type: Aadhar_Card / PAN_Card / Voter_ID / Driving_License / Other / Not_A_Document

  Use Not_A_Document ONLY if there is NO identity document visible anywhere in the image
  — even partially or inside a PDF viewer, scanner UI, or Adobe Acrobat screenshot.
  Examples: selfies, group photos, landscape photos, charts, graphs, blank pages,
  app or website screenshots with no ID document present.
  If any ID document is visible anywhere in the image, attempt extraction — do NOT use Not_A_Document.

Step 2 — Extract client_name (ALL document types):
  - PRIMARY cardholder name ONLY.
  - On Aadhaar letters the name appears after "To," — use that.
  - If you see "S/O", "D/O", "W/O", "Father:", "Husband:" followed by a name — that is NOT the client. IGNORE it.
  - Do NOT include address, city, state, PIN, or mobile number.

Step 3 — Extract fields based on document_type:

  Aadhar_Card:
    - date_of_birth: DDMMYYYY. Look for "DOB:", "Date of Birth:", "जन्म तिथि". Empty string if not found.
    - aadhaar_last4: LAST 4 digits only of the 12-digit Aadhaar number. Empty string if not visible.

  PAN_Card:
    - date_of_birth: DDMMYYYY. Empty string if not found.
    - pan_number: full 10-character PAN (e.g. ABCDE1234F). Empty string if not found.

  Voter_ID:
    - date_of_birth: DDMMYYYY. Empty string if not found.
    - voter_id_number: the Epic/Voter ID number (e.g. ABC1234567). Empty string if not found.

  Driving_License:
    - date_of_birth: DDMMYYYY. Empty string if not found.
    - dl_number: the DL number (e.g. MH0120210012345). Empty string if not found.

  Other:
    - date_of_birth: DDMMYYYY. Empty string if not found.

Step 4 — type_keywords: list 2-4 exact text strings you can visibly read in the image that helped you identify the document type.
  Examples: ["UIDAI", "Aadhaar"], ["Income Tax Department"], ["Election Commission of India"], ["Transport Department"]

Return ONLY valid JSON. No markdown. No explanation. Always include all keys, use empty string if not applicable.
{
  "document_type":   "...",
  "client_name":     "...",
  "date_of_birth":   "...",
  "aadhaar_last4":   "...",
  "pan_number":      "...",
  "voter_id_number": "...",
  "dl_number":       "...",
  "type_keywords":   ["...", "..."]
}"""


# Keyword signatures per document type (regex patterns)
KEYWORD_SIGNATURES = {
    "Aadhar_Card":      [r"UIDAI", r"Aadhaar", r"आधार", r"Unique Identification", r"VID"],
    "PAN_Card":         [r"Income Tax", r"Permanent Account", r"INCOME TAX DEPARTMENT"],
    "Voter_ID":         [r"Election Commission", r"EPIC", r"Electors Photo"],
    "Driving_License":  [r"Transport", r"Driving Licen", r"\bRTO\b", r"MOTOR VEHICLES"],
}


def verify_classification(ai_type: str, keywords: list) -> str:
    """
    Cross-check AI claimed document_type against extracted keywords using regex.
    Returns the verified type, or overrides if mismatch found.
    """
    if not keywords:
        return ai_type

    keyword_blob = " ".join(keywords)

    # Find which type the keywords actually match
    matched_type = None
    for doc_type, patterns in KEYWORD_SIGNATURES.items():
        for pattern in patterns:
            if re.search(pattern, keyword_blob, re.IGNORECASE):
                matched_type = doc_type
                break
        if matched_type:
            break

    if matched_type is None:
        # Keywords didn't match anything clearly — trust AI but flag
        print(f"    ⚠️  Keywords unrecognized: {keywords} — keeping AI type: {ai_type}")
        return ai_type

    if matched_type != ai_type:
        print(f"    🔁 Type override: AI said '{ai_type}' but keywords {keywords} → '{matched_type}'")
        return matched_type

    print(f"    ✅ Type verified: '{ai_type}' confirmed by keywords {keywords}")
    return ai_type


def resize_for_ai(image_bytes: bytes) -> str:
    """Resize to MAX_AI_EDGE on longest side, return base64 JPEG string."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    w, h = img.size
    if max(w, h) > MAX_AI_EDGE:
        scale = MAX_AI_EDGE / max(w, h)
        img   = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    print(f"    📏 AI input: {img.size[0]}x{img.size[1]}px")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def _valid_dob(dob: str) -> bool:
    """Validate DDMMYYYY date string."""
    if not dob or len(dob) != 8 or not dob.isdigit():
        return False
    d, m, y = int(dob[:2]), int(dob[2:4]), int(dob[4:])
    return 1 <= d <= 31 and 1 <= m <= 12 and 1900 <= y <= 2025


def _validate_uid_fields(result: dict) -> tuple:
    """
    Validate and sanitize extracted UID/date fields.
    Returns (cleaned_result, any_field_was_invalidated).
    """
    invalidated = False

    aadhaar = result.get("aadhaar_last4", "")
    if aadhaar and not re.fullmatch(r"\d{4}", aadhaar):
        print(f"    ⚠️  Invalid aadhaar_last4: '{aadhaar}' — cleared")
        result["aadhaar_last4"] = ""
        invalidated = True

    pan = (result.get("pan_number") or "").upper()
    if pan:
        if re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", pan):
            result["pan_number"] = pan
        else:
            print(f"    ⚠️  Invalid pan_number: '{pan}' — cleared")
            result["pan_number"] = ""
            invalidated = True

    voter = (result.get("voter_id_number") or "").upper()
    if voter:
        if re.fullmatch(r"[A-Z]{2,3}[0-9]{6,8}", voter):
            result["voter_id_number"] = voter
        else:
            print(f"    ⚠️  Invalid voter_id_number: '{voter}' — cleared")
            result["voter_id_number"] = ""
            invalidated = True

    dl = (result.get("dl_number") or "").upper()
    if dl:
        if re.fullmatch(r"[A-Z]{2}[0-9]{2}[A-Z0-9\-]{5,15}", dl):
            result["dl_number"] = dl
        else:
            print(f"    ⚠️  Invalid dl_number: '{dl}' — cleared")
            result["dl_number"] = ""
            invalidated = True

    dob = result.get("date_of_birth", "")
    if dob and not _valid_dob(dob):
        print(f"    ⚠️  Invalid date_of_birth: '{dob}' — cleared")
        result["date_of_birth"] = ""
        invalidated = True

    return result, invalidated


class LocalBrain:
    def __init__(self):
        self.client   = None
        self.model_id = None
        self._connect()

    def _connect(self):
        try:
            c      = OpenAI(base_url=LM_STUDIO_URL, api_key="lm-studio", timeout=10)
            models = c.models.list()
            if models.data:
                self.client   = c
                self.model_id = models.data[0].id
                print(f"✅ AI: LM Studio ready — {self.model_id}")
            else:
                print("⚠️  AI: LM Studio running but no model loaded")
        except Exception as e:
            print(f"⚠️  AI: LM Studio not available — {e}")

    def is_alive(self) -> bool:
        """Quick 5-second ping to see if LM Studio is reachable."""
        try:
            c = OpenAI(base_url=LM_STUDIO_URL, api_key="lm-studio", timeout=5)
            c.models.list()
            return True
        except Exception:
            return False

    def analyze(self, image_bytes: bytes) -> dict:
        # Auto-reconnect if the client was never initialised or dropped
        if not self.client:
            print("    🔄 AI: attempting reconnect...")
            self._connect()
        if not self.client:
            return self._unreachable("LM Studio unreachable — could not connect")

        try:
            b64 = resize_for_ai(image_bytes)
            t0  = time.time()

            resp = self.client.chat.completions.create(
                model=self.model_id,
                messages=[{"role": "user", "content": [
                    {"type": "text",      "text": PROMPT},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}
                ]}],
                max_tokens=250,
                temperature=0.1,
                timeout=60
            )

            elapsed = round(time.time() - t0, 2)
            raw     = resp.choices[0].message.content
            clean   = raw.replace("```json", "").replace("```", "").strip()

            try:
                result = json.loads(clean)
            except json.JSONDecodeError:
                return self._fail(f"JSON parse error — raw: {raw[:200]}")

            # Verify and potentially override document type using keywords
            ai_type           = result.get("document_type", "")
            keywords          = result.get("type_keywords", [])
            verified_type     = verify_classification(ai_type, keywords)
            result["document_type"]       = verified_type
            result["type_overridden"]     = (verified_type != ai_type)

            # Reject non-documents before storing anything
            if verified_type == "Not_A_Document":
                print(f"    🚫 Not a KYC document — rejected")
                return {
                    "document_type":   "Not_A_Document",
                    "client_name":     "",
                    "date_of_birth":   "",
                    "aadhaar_last4":   "",
                    "pan_number":      "",
                    "voter_id_number": "",
                    "dl_number":       "",
                    "type_keywords":   keywords,
                    "type_overridden": (verified_type != ai_type),
                    "method":          "not_a_document",
                    "confidence":      0.0,
                    "needs_review":    False,
                }

            # Validate extracted UID and date fields — clear garbled values
            result, field_invalidated = _validate_uid_fields(result)

            # needs_review logic
            doc_type = result.get("document_type", "")
            has_uid  = (
                (doc_type == "Aadhar_Card"     and result.get("aadhaar_last4")) or
                (doc_type == "PAN_Card"         and result.get("pan_number")) or
                (doc_type == "Voter_ID"         and result.get("voter_id_number")) or
                (doc_type == "Driving_License"  and result.get("dl_number"))
            )
            result["method"]       = "lm_studio"
            result["confidence"]   = 0.90
            result["_time"]        = elapsed
            result["needs_review"] = (
                not result.get("client_name") or
                result.get("client_name", "").lower() in ["unknown", "unknown_client"] or
                result.get("document_type", "").lower() in ["unknown", "other", ""] or
                not has_uid or
                field_invalidated
            )

            print(f"    ✅ Done in {elapsed}s | {result.get('client_name')} / {result.get('document_type')} | review={result['needs_review']}")
            return result

        except (ConnectionError, OSError) as e:
            # Network-level failure — LM Studio crashed or restarted
            self.client   = None
            self.model_id = None
            return self._unreachable(str(e))
        except Exception as e:
            err = str(e)
            # httpx / openai wraps connection errors in generic Exception
            if any(k in err.lower() for k in ("connection", "connect", "refused", "unreachable", "timeout")):
                self.client   = None
                self.model_id = None
                return self._unreachable(err)
            # LM Studio model not ready (still loading, switching, or operation canceled)
            if any(k in err.lower() for k in ("failed to load model", "operation canceled", "model not found", "no model loaded")):
                return self._unreachable(err)
            return self._fail(err)

    def _unreachable(self, reason: str) -> dict:
        """AI service is offline / crashed — caller should queue for retry."""
        print(f"    🔌 AI unreachable: {reason}")
        return {
            "document_type":   "Unsorted",
            "client_name":     "Unsorted",
            "date_of_birth":   "",
            "aadhaar_last4":   "",
            "pan_number":      "",
            "voter_id_number": "",
            "dl_number":       "",
            "type_keywords":   [],
            "type_overridden": False,
            "method":          "ai_unreachable",
            "confidence":      0.0,
            "needs_review":    True,
            "error":           reason
        }

    def _fail(self, reason: str) -> dict:
        """AI ran but could not extract useful data (bad image, wrong doc, etc.)."""
        print(f"    ❌ Local AI failed: {reason}")
        return {
            "document_type":   "Unsorted",
            "client_name":     "UNKNOWN_CLIENT",
            "date_of_birth":   "",
            "aadhaar_last4":   "",
            "pan_number":      "",
            "voter_id_number": "",
            "dl_number":       "",
            "type_keywords":   [],
            "type_overridden": False,
            "method":          "failed",
            "confidence":      0.0,
            "needs_review":    True,
            "error":           reason
        }


current_brain = LocalBrain()


# ------------------------------------------------------------------ #
#  GEMINI FALLBACK (retry-pending only — never used on fresh uploads) #
# ------------------------------------------------------------------ #
class GeminiBrain:
    def __init__(self):
        self.available = False
        if not GEMINI_API_KEY:
            print("⚠️  Gemini: no GEMINI_API_KEY set — fallback disabled")
            return
        try:
            import google.generativeai as genai
            genai.configure(api_key=GEMINI_API_KEY)
            self._genai = genai
            self.model  = genai.GenerativeModel(GEMINI_MODEL)
            self.available = True
            print(f"✅ Gemini: ready — {GEMINI_MODEL}")
        except ImportError:
            print("⚠️  Gemini: google-generativeai not installed — fallback disabled")
        except Exception as e:
            print(f"⚠️  Gemini: init failed — {e}")

    def analyze(self, image_bytes: bytes) -> dict:
        if not self.available:
            return self._unavailable("Gemini not configured")
        try:
            b64     = base64.b64encode(image_bytes).decode()
            t0      = time.time()
            resp    = self.model.generate_content([
                PROMPT,
                {"mime_type": "image/jpeg", "data": b64}
            ])
            elapsed = round(time.time() - t0, 2)
            raw     = resp.text.strip()
            clean   = raw.replace("```json", "").replace("```", "").strip()
            try:
                result = json.loads(clean)
            except json.JSONDecodeError:
                return self._unavailable(f"JSON parse error — raw: {raw[:200]}")

            ai_type       = result.get("document_type", "")
            keywords      = result.get("type_keywords", [])
            verified_type = verify_classification(ai_type, keywords)
            result["document_type"]   = verified_type
            result["type_overridden"] = (verified_type != ai_type)

            if verified_type == "Not_A_Document":
                print(f"    🚫 Gemini: Not a KYC document")
                return {
                    "document_type":   "Not_A_Document",
                    "client_name":     "",
                    "date_of_birth":   "",
                    "aadhaar_last4":   "",
                    "pan_number":      "",
                    "voter_id_number": "",
                    "dl_number":       "",
                    "type_keywords":   keywords,
                    "type_overridden": (verified_type != ai_type),
                    "method":          "not_a_document",
                    "confidence":      0.0,
                    "needs_review":    False,
                }

            result, field_invalidated = _validate_uid_fields(result)

            doc_type = result.get("document_type", "")
            has_uid  = (
                (doc_type == "Aadhar_Card"    and result.get("aadhaar_last4")) or
                (doc_type == "PAN_Card"        and result.get("pan_number")) or
                (doc_type == "Voter_ID"        and result.get("voter_id_number")) or
                (doc_type == "Driving_License" and result.get("dl_number"))
            )
            result["method"]       = "gemini"
            result["confidence"]   = 0.92
            result["_time"]        = elapsed
            result["needs_review"] = (
                not result.get("client_name") or
                result.get("client_name", "").lower() in ["unknown", "unknown_client"] or
                result.get("document_type", "").lower() in ["unknown", "other", ""] or
                not has_uid or
                field_invalidated
            )
            print(f"    ✅ Gemini done in {elapsed}s | {result.get('client_name')} / {result.get('document_type')} | review={result['needs_review']}")
            return result

        except Exception as e:
            return self._unavailable(str(e))

    def _unavailable(self, reason: str) -> dict:
        print(f"    ❌ Gemini failed: {reason}")
        return {
            "document_type":   "Unsorted",
            "client_name":     "UNKNOWN_CLIENT",
            "date_of_birth":   "",
            "aadhaar_last4":   "",
            "pan_number":      "",
            "voter_id_number": "",
            "dl_number":       "",
            "type_keywords":   [],
            "type_overridden": False,
            "method":          "failed",
            "confidence":      0.0,
            "needs_review":    True,
            "error":           reason
        }


gemini_brain = GeminiBrain()