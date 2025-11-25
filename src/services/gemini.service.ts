import { Injectable } from '@angular/core';
import { GoogleGenAI, Type } from '@google/genai';
import { ChatMessage } from '../app.component';

@Injectable({ providedIn: 'root' })
export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
     // IMPORTANT: This relies on the API_KEY being set in the environment
     // Do not add any UI or logic to ask the user for this key.
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
  }

  private async generateContent(prompt: string): Promise<string> {
    try {
      const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
      });
      return response.text;
    } catch (error) {
      console.error('Error generating content:', error);
      return 'Sorry, I encountered an error. Please try again.';
    }
  }

  async generateFirstQuestion(resumeText: string): Promise<string> {
    const prompt = `You are a world-class senior UX hiring manager. Your task is to start a simulated interview. Below is the candidate's resume. Begin the interview with a warm, professional greeting, and then ask a single, general opening question to get to know the candidate. The question itself should be a maximum of 15 words. Just provide the greeting and the first question.

Example: "Hello, thanks for your time today. To begin, could you walk me through your background briefly?"

RESUME:
${resumeText}`;
    return this.generateContent(prompt);
  }

  async generateFollowUpQuestion(conversationHistory: ChatMessage[]): Promise<string> {
    const transcript = conversationHistory
      .map(msg => `${msg.role === 'user' ? 'Candidate' : 'Interviewer'}: ${msg.text}`)
      .join('\n');
    const prompt = `You are a world-class senior UX hiring manager conducting a natural, conversational interview. Below is the transcript of the conversation so far. Based on the candidate's last answer, ask a relevant and insightful follow-up question. The question must be a maximum of 15 words and a single question. Your goal is to guide the conversation from general topics to more specific technical and HR-related questions about UX design. Keep the flow smooth and human-like. Do not add any preamble. Just provide the next question.

TRANSCRIPT:
${transcript}`;
    return this.generateContent(prompt);
  }

  async analyzeMistakes(question: string, answer: string): Promise<string> {
    const prompt = `You are a meticulous communication coach. Your task is to analyze a candidate's answer for grammatical errors, awkward phrasing, and poor word choice.
Question asked: "${question}"
Candidate's answer: "${answer}"

You must analyze the answer and return a JSON array of objects. Each object represents a segment of the original answer.
- The 'text' from all segments combined MUST perfectly reconstruct the original answer, including spaces and punctuation.
- A segment should be marked as an error ('isError': true) only for clear mistakes.
- If a segment is an error, provide a concise 'correction'.
- If there are no mistakes, return a single segment object containing the entire answer with 'isError': false.

Example for an answer "I has experience with user research.":
[
  { "text": "I has ", "isError": true, "correction": "I have " },
  { "text": "experience with user research.", "isError": false, "correction": "" }
]`;

    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { 
                  type: Type.STRING,
                  description: "A segment of the original answer. The concatenation of all 'text' properties should form the complete, original answer."
                },
                isError: { 
                  type: Type.BOOLEAN,
                  description: "A boolean flag that is true if this text segment contains a grammatical mistake or could be significantly improved."
                },
                correction: { 
                  type: Type.STRING,
                  description: "If 'isError' is true, provide the corrected version of the text. If 'isError' is false, this must be an empty string."
                },
              },
              required: ["text", "isError", "correction"]
            }
          }
        }
      });
      return response.text;
    } catch (error) {
        console.error('Error analyzing mistakes:', error);
        // Return a valid JSON array indicating an error, so the frontend doesn't crash on parse.
        return JSON.stringify([{
            text: `Sorry, an error occurred while analyzing the answer.`,
            isError: false,
            correction: ''
        }]);
    }
  }

  async suggestAnswer(question: string, userAnswer: string): Promise<string> {
    const userAnswerWordCount = userAnswer.split(/\s+/).filter(Boolean).length;
    let maxWords = Math.min(120, userAnswerWordCount);
    
    // If the user's answer is very short, a suggestion of the same length isn't helpful.
    // Provide a slightly more fleshed-out answer, but keep it concise.
    if (userAnswerWordCount < 30) {
      maxWords = 50;
    }

    const prompt = `You are an expert career coach for senior UX professionals. The user was asked the following interview question: "${question}".

Provide an ideal, model answer. Follow these strict rules:
1.  **Style:** The answer must be crisp, simple, concise, and easy to understand. Use simple words and sentences. Avoid "jazzy" or complicated vocabulary. The tone must be professional and confident.
2.  **Word Count:** The word count of your answer MUST be less than or equal to ${maxWords} words. This is a hard limit.
3.  **Content:** The answer should be structured and demonstrate senior-level thinking.
4.  **Formatting:** Do not add any preamble like 'Here is a suggested answer'. Just provide the answer itself.`;
    return this.generateContent(prompt);
  }
}