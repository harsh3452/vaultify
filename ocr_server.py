from flask import Flask, request, jsonify
from paddleocr import PaddleOCR
import base64
from io import BytesIO
from PIL import Image

app = Flask(__name__)
ocr = PaddleOCR(use_textline_orientation=True, lang='en')

@app.route('/ocr', methods=['POST'])
def extract_ocr():
    try:
        img_data = base64.b64decode(request.json['image'])
        img = Image.open(BytesIO(img_data))
        result = ocr.ocr(img, cls=True)
        
        if not result or not result[0]:
            return jsonify({'text': '', 'success': False})
        
        text = '\n'.join([line[1][0] for line in result[0]])
        return jsonify({'text': text, 'success': True})
    except Exception as e:
        return jsonify({'text': '', 'success': False, 'error': str(e)})

if __name__ == '__main__':
    app.run(port=5000, debug=False)