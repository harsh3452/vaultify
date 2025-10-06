import sys
import json
import spacy

def find_person_name(text):
    """Process text with spaCy to find the first PERSON entity."""
    try:
        # Load the pre-downloaded spaCy model
        nlp = spacy.load("en_core_web_sm")
    except OSError:
        # If the model isn't found, print a clear error to stderr
        print(
            "Error: spaCy model 'en_core_web_sm' not found. "
            "Please run 'python -m spacy download en_core_web_sm'",
            file=sys.stderr
        )
        sys.exit(1)

    doc = nlp(text)

    # Find the first entity labeled as a person
    for ent in doc.ents:
        if ent.label_ == "PERSON":
            # Return the found name as a JSON object
            return json.dumps({"name": ent.text})
    
    # If no person is found, return null
    return json.dumps({"name": None})

if __name__ == "__main__":
    # Read all text from standard input
    input_text = sys.stdin.read()
    # Run the main function and print the JSON result
    result_json = find_person_name(input_text)
    print(result_json)