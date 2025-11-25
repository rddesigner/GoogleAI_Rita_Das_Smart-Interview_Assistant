import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class SpeechService {
  isListening = signal(false);
  countdown = signal<number | null>(null); // Countdown in seconds

  private synth = window.speechSynthesis;
  private recognition: any;
  private indianVoice: SpeechSynthesisVoice | undefined;

  // Timers
  private silenceTimer: any = null;
  private countdownInterval: any = null;
  private readonly SILENCE_TIMEOUT = 10000; // 10 seconds
  private readonly MAX_DURATION_SECONDS = 120; // 2 minutes

  constructor() {
    this.loadVoices();
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.lang = 'en-IN';
        this.recognition.interimResults = true;
    }
  }

  private loadVoices() {
    const setVoice = () => {
      const voices = this.synth.getVoices();
      
      // Priority-based voice selection to find the best match for an Indian female voice.
      const isFemale = (v: SpeechSynthesisVoice) => v.name.toLowerCase().includes('female');
      
      this.indianVoice = 
        // 1. Highest priority: Google's Indian English Female voice
        voices.find(v => v.lang === 'en-IN' && isFemale(v) && v.name.includes('Google')) ||
        // 2. Any Indian English Female voice
        voices.find(v => v.lang === 'en-IN' && isFemale(v)) ||
        // 3. Google's Indian English voice (could be male)
        voices.find(v => v.lang === 'en-IN' && v.name.includes('Google')) ||
        // 4. Any Indian English voice
        voices.find(v => v.lang === 'en-IN') ||
        // 5. Fallback to any available English voice
        voices.find(v => v.lang.startsWith('en-'));
    };

    if (this.synth.getVoices().length !== 0) {
      setVoice();
    } else {
      this.synth.onvoiceschanged = setVoice;
    }
  }

  speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        if (this.synth.speaking) {
            this.synth.cancel();
        }
        const utterance = new SpeechSynthesisUtterance(text);
        if (this.indianVoice) {
            utterance.voice = this.indianVoice;
        }
        utterance.rate = 0.9; // Slower speed for clarity and a more natural pace.
        utterance.pitch = 1; // Default pitch.
        utterance.onend = () => resolve();
        utterance.onerror = (event) => reject(event);
        this.synth.speak(utterance);
    });
  }
  
  stopSpeaking() {
      if(this.synth.speaking) {
          this.synth.cancel();
      }
  }

  private clearTimers() {
      if (this.silenceTimer) clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
      
      if (this.countdownInterval) clearInterval(this.countdownInterval);
      this.countdownInterval = null;
      this.countdown.set(null);
  }

  listen(onResult: (transcript: string) => void, onFinal: (transcript: string) => void): Promise<void> {
    if (!this.recognition) {
        alert('Speech recognition is not supported in this browser.');
        return Promise.reject('Speech recognition not supported');
    }
    if (this.isListening()) {
        return Promise.resolve(); // Already listening
    }
    
    return new Promise((resolve, reject) => {
        this.isListening.set(true);

        this.recognition.onstart = () => {
            this.clearTimers();
            
            // Start countdown
            this.countdown.set(this.MAX_DURATION_SECONDS);
            this.countdownInterval = setInterval(() => {
                this.countdown.update(c => {
                    const newTime = (c ?? 1) - 1;
                    if (newTime <= 0) {
                        this.stopListening();
                        return 0;
                    }
                    return newTime;
                });
            }, 1000);
        };
        
        this.recognition.onresult = (event: any) => {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;

            let finalTranscript = '';
            let interimTranscript = '';
            for (let i = 0; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            onResult(finalTranscript + interimTranscript);
        };

        this.recognition.onspeechend = () => {
            this.silenceTimer = setTimeout(() => this.stopListening(), this.SILENCE_TIMEOUT);
        };

        this.recognition.onend = () => {
            this.clearTimers();
            this.isListening.set(false);
            resolve();
        };
        
        this.recognition.onerror = (event: any) => {
            console.error('Speech recognition error', event.error);
            this.isListening.set(false);
            this.clearTimers();
            reject(event.error);
        };

        this.recognition.start();
    });
  }

  stopListening() {
    if(this.isListening()) {
        this.recognition.stop();
        // The onend event will handle clearing timers and setting isListening to false.
    }
  }
}
