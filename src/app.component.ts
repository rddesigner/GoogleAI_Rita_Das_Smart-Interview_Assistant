import { Component, ChangeDetectionStrategy, signal, WritableSignal, effect, ElementRef, viewChild, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GeminiService } from './services/gemini.service';
import { PdfParserService } from './services/pdf-parser.service';
import { SpeechService } from './services/speech.service';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  text: string;
  questionContext?: string; // For user messages, what was the question they answered
  isAnalyzing: WritableSignal<boolean>;
}

export interface MistakeSegment {
  text: string;
  isError: boolean;
  correction?: string;
}

export interface ModalData {
    title: string;
    isSuggestion: boolean;
    suggestionContent?: string;
    mistakeContent?: MistakeSegment[];
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule],
})
export class AppComponent {
  // Services
  geminiService = new GeminiService();
  pdfParserService = new PdfParserService();
  speechService = new SpeechService();

  // State Signals
  appState = signal<'initial' | 'loading' | 'chat'>('initial');
  loadingMessage = signal('Processing...');
  conversation: WritableSignal<ChatMessage[]> = signal([]);
  userInput = signal('');
  modalData: WritableSignal<ModalData | null> = signal(null);
  
  isListening = this.speechService.isListening;
  countdown = this.speechService.countdown;
  formattedCountdown = computed(() => {
    const totalSeconds = this.countdown();
    if (totalSeconds === null) return '';
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  });
  
  // View Children
  chatContainer = viewChild<ElementRef<HTMLDivElement>>('chatContainer');
  userInputElement = viewChild<ElementRef<HTMLTextAreaElement>>('userInputElement');

  private nextId = 0;

  constructor() {
    effect(() => {
      // Auto-scroll chat
      if (this.conversation().length > 0 && this.chatContainer()) {
        const element = this.chatContainer()!.nativeElement;
        element.scrollTop = element.scrollHeight;
      }
      // Auto-resize textarea
      if(this.userInputElement()) {
        const textarea = this.userInputElement()!.nativeElement;
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
      }
    }, { allowSignalWrites: true });
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    if (file.type !== 'application/pdf') {
      alert('Please upload a PDF file.');
      return;
    }

    this.appState.set('loading');
    this.loadingMessage.set('Reading your resume...');

    try {
      const resumeText = await this.pdfParserService.getText(file);
      this.conversation.set([{
          id: this.nextId++,
          role: 'system',
          text: `Resume processed. The interview will now begin.`,
          isAnalyzing: signal(false),
      }]);
      this.appState.set('chat');
      
      this.loadingMessage.set('Thinking of the first question...');
      this.appState.set('loading');

      const firstQuestion = await this.geminiService.generateFirstQuestion(resumeText);
      this.addMessage('assistant', firstQuestion);
      this.appState.set('chat');
      await this.speechService.speak(firstQuestion);

    } catch (error) {
      console.error('Error processing PDF:', error);
      alert('There was an error processing your resume. Please try again.');
      this.appState.set('initial');
    }
  }

  private addMessage(role: 'user' | 'assistant' | 'system', text: string, questionContext?: string) {
    const newMessage: ChatMessage = {
      id: this.nextId++,
      role,
      text,
      questionContext,
      isAnalyzing: signal(false),
    };
    this.conversation.update(current => [...current, newMessage]);
  }

  async submitAnswer() {
    const text = this.userInput().trim();
    if (!text || this.appState() === 'loading') return;

    this.speechService.stopListening();
    
    // FIX: Replaced `findLast` with a compatible alternative to support older TS/JS targets.
    const lastQuestion = [...this.conversation()].reverse().find(m => m.role === 'assistant')?.text || 'No question found';
    this.addMessage('user', text, lastQuestion);
    this.userInput.set('');

    this.appState.set('loading');
    this.loadingMessage.set('Thinking of the next question...');

    // A small delay to make it feel more natural
    await new Promise(resolve => setTimeout(resolve, 500));

    const followUpQuestion = await this.geminiService.generateFollowUpQuestion(this.conversation());
    this.addMessage('assistant', followUpQuestion);
    this.appState.set('chat');
    await this.speechService.speak(followUpQuestion);
  }

  async startListening() {
    if (this.isListening()) {
      this.speechService.stopListening();
      return;
    }

    try {
        await this.speechService.listen(
            (interimTranscript) => this.userInput.set(interimTranscript),
            (finalTranscript) => { /* Not used in this continuous setup */ }
        );
    } catch (error) {
        console.error('Mic error:', error);
        if (typeof error === 'string' && (error.includes('not-allowed') || error.includes('permission'))) {
            alert('Microphone access was denied. Please allow microphone permissions in your browser settings and refresh the page.');
        } else {
             alert(`An error occurred with the microphone: ${error}`);
        }
    }
  }

  async requestAnalysis(type: 'mistakes' | 'suggestion', message: ChatMessage) {
    if (!message.questionContext) return;
    message.isAnalyzing.set(true);

    if (type === 'mistakes') {
      const analysisJson = await this.geminiService.analyzeMistakes(message.questionContext, message.text);
      try {
        const mistakeContent: MistakeSegment[] = JSON.parse(analysisJson);
        this.modalData.set({
          title: 'Mistake Analysis',
          isSuggestion: false,
          mistakeContent: mistakeContent
        });
      } catch (e) {
         console.error("Failed to parse mistake analysis JSON", e, analysisJson);
         this.modalData.set({
             title: 'Error',
             isSuggestion: false,
             suggestionContent: 'Sorry, I could not analyze the mistakes in the response.'
         });
      }
    } else { // suggestion
      const suggestion = await this.geminiService.suggestAnswer(message.questionContext, message.text);
      this.modalData.set({
        title: 'Suggested Answer',
        isSuggestion: true,
        suggestionContent: suggestion,
      });
    }

    message.isAnalyzing.set(false);
  }

  closeModal() {
    this.modalData.set(null);
    this.speechService.stopSpeaking();
  }

  playSuggestionAudio() {
    const content = this.modalData()?.suggestionContent;
    if (content) {
      this.speechService.speak(content);
    }
  }
}
