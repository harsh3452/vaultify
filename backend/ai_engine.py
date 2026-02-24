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

LM_STUDIO_URL = "http://localhost:1234/v1"
MAX_AI_EDGE   = 2000

# Gemini / Google Vision intentionally excluded from upload pipeline.
# They will be added later for the /review retry flow only.

PROMPT = """You are a KYC document parser for Indian ID documents.
The image may be a physical card photo, a PDF screenshot, a scanned letter, or a screenshot from a PDF viewer — all are valid inputs.
If the image contains multiple panels or copies of the same document, extract from whichever panel is most legible.

Step 1 — Identify document_type: Aadhar_Card / PAN_Card / Voter_ID / Driving_License / Other

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


class LocalBrain:
    def __init__(self):
        self.client   = None
        self.model_id = None
        self._connect()

    def _connect(self):
        try:
            c      = OpenAI(base_url=LM_STUDIO_URL, api_key="lm-studio")
            models = c.models.list()
            if models.data:
                self.client   = c
                self.model_id = models.data[0].id
                print(f"✅ AI: LM Studio ready — {self.model_id}")
            else:
                print("⚠️  AI: LM Studio running but no model loaded")
        except Exception as e:
            print(f"⚠️  AI: LM Studio not available — {e}")

    def analyze(self, image_bytes: bytes) -> dict:
        if not self.client:
            return self._fail("LM Studio not connected")

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
                temperature=0.1
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
                not has_uid
            )

            print(f"    ✅ Done in {elapsed}s | {result.get('client_name')} / {result.get('document_type')} | review={result['needs_review']}")
            return result

        except Exception as e:
            return self._fail(str(e))

    def _fail(self, reason: str) -> dict:
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