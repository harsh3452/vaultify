import os
import json
import base64
import google.generativeai as genai
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

# Unified prompt for both local and cloud AI to ensure consistent extraction
PROMPT = """
Analyze this Indian ID document.
Extract the document type (Aadhar_Card/PAN_Card/Voter_ID/Driving_License/Other), the full client name, and the date of birth.
Return ONLY JSON (no markdown, no extra text):
{
    "document_type": "...",
    "client_name": "...",
    "date_of_birth": "DDMMYYYY"
}
"""

class HybridBrain:
    def __init__(self):
        # --- TIER 2: CLOUD BACKUP (Gemini) ---
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("⚠️ WARNING: GEMINI_API_KEY missing. Cloud fallback disabled.")
            self.cloud_model = None
        else:
            genai.configure(api_key=api_key)
            self.cloud_model = genai.GenerativeModel('gemini-2.0-flash')
        
        # --- TIER 1: LOCAL LM STUDIO ---
        self.lm_studio_url = "http://localhost:1234/v1"
        self.use_local = False
        
        try:
            # Create OpenAI client pointing to LM Studio
            self.local_client = OpenAI(
                base_url=self.lm_studio_url,
                api_key="lm-studio"  # LM Studio doesn't need real key
            )
            
            # Check if server is responding
            models = self.local_client.models.list()
            if models.data:
                self.use_local = True
                model_name = models.data[0].id
                print(f"✅ AI: LM Studio ({model_name}) ready at {self.lm_studio_url}")
            else:
                print(f"⚠️ AI: LM Studio running but no model loaded")
        except Exception as e:
            print(f"⚠️ AI: LM Studio not available - {e}")
    
    def analyze(self, image_path):
        result = None
        method = None
        
        # --- TIER 1: LOCAL LM STUDIO ATTEMPT ---
        if self.use_local:
            try:
                print(f"🧠 Analyzing with LM Studio (local)...")
                
                # Read image and encode to base64 (LM Studio expects this)
                with open(image_path, 'rb') as f:
                    image_data = base64.b64encode(f.read()).decode('utf-8')
                
                response = self.local_client.chat.completions.create(
                    model="local-model",  # LM Studio uses loaded model
                    messages=[
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": PROMPT
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{image_data}"
                                    }
                                }
                            ]
                        }
                    ],
                    max_tokens=500,
                    temperature=0.1
                )
                
                raw = response.choices[0].message.content
                clean = raw.replace("```json", "").replace("```", "").strip()
                result = json.loads(clean)
                method = 'lm_studio'
                
            except Exception as e:
                print(f"⚠️ LM Studio failed: {e}. Trying Gemini...")
        
        # --- TIER 2: CLOUD FALLBACK (GEMINI) ---
        if not result and self.cloud_model:
            try:
                print("☁️ Analyzing with Gemini (cloud)...")
                file = genai.upload_file(image_path)
                
                response = self.cloud_model.generate_content([file, PROMPT])
                clean = response.text.replace("```json", "").replace("```", "").strip()
                result = json.loads(clean)
                method = 'gemini'
                
            except Exception as e:
                print(f"❌ Gemini failed: {e}")
                return {
                    "error": "All AI systems failed",
                    "details": str(e),
                    "document_type": "Unknown",
                    "client_name": "Unknown_Client",
                    "date_of_birth": "",
                    "confidence": 0.0,
                    "method": "failed",
                    "needs_review": True
                }
        
        # --- ENRICH RESULT ---
        if result:
            result['confidence'] = 0.90 if method == 'lm_studio' else 0.85
            result['method'] = method
            result['needs_review'] = (
                result.get('client_name', '').lower() in ['unknown', 'unknown_client', ''] or
                result.get('document_type', '').lower() in ['unknown', 'other', '']
            )
        
        return result

current_brain = HybridBrain()