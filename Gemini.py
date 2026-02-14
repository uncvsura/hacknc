import streamlit as st
import google.generativeai as genai
import os

# Configure the Gemini API
# Replace 'YOUR_API_KEY' with your actual Gemini API key or set it as an environment variable
API_KEY = os.getenv(gen-lang-client-615299254)
genai.configure(api_key="GEMINI_API_KEY")

def fact_check_info(user_input):
    """
    Uses Gemini API to fact-check the provided information.
    """
    try:
        model = genai.GenerativeModel('gemini-pro')
        prompt = (
            f"You are a professional fact-checker. Analyze the following statement for accuracy. "
            f"Provide a verdict (True, False, or Partially True), a detailed explanation, "
            f"and list credible sources if possible.\n\n"
            f"Statement: {user_input}"
        )
        
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        return f"Error connecting to Gemini API: {str(e)}"

# Streamlit UI Setup
st.set_page_config(page_title="AI Fact Checker", page_icon="🔍")

st.title("🔍 AI Fact Checker")
st.write("Enter a claim or information below to verify its accuracy using Google Gemini.")

# User Input
user_claim = st.text_area("What information would you like to fact-check?", placeholder="e.g., The Great Wall of China is visible from the moon.")

if st.button("Verify Information"):
    if not API_KEY:
        st.error("API Key not found. Please set the GEMINI_API_KEY environment variable.")
    elif user_claim.strip() == "":
        st.warning("Please enter some text to check.")
    else:
        with st.spinner("Analyzing information..."):
            result = fact_check_info(user_claim)
            
            st.subheader("Fact Check Result:")
            st.markdown(result)

# Footer
st.divider()
st.caption("Note: AI can make mistakes. Always cross-reference important information with primary sources.")