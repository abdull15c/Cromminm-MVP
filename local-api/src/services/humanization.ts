// Human-like behavior simulation for browser automation
// This module provides realistic mouse movements, keyboard timing, and scroll patterns

export type HumanizationConfig = {
  mouseSpeed: 'slow' | 'medium' | 'fast';
  typingSpeed: 'slow' | 'medium' | 'fast';
  enableMicroPauses: boolean;
  enableTypos: boolean;
};

const DEFAULT_CONFIG: HumanizationConfig = {
  mouseSpeed: 'medium',
  typingSpeed: 'medium',
  enableMicroPauses: true,
  enableTypos: true,
};

// Random number generator with bounds
function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

// Easing functions for smooth movements
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Generate Bezier curve points for mouse movement
function generateBezierPath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  steps: number
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  
  // Generate control points for natural curve
  const controlX1 = startX + (endX - startX) * randomFloat(0.2, 0.4);
  const controlY1 = startY + (endY - startY) * randomFloat(-0.2, 0.2);
  const controlX2 = startX + (endX - startX) * randomFloat(0.6, 0.8);
  const controlY2 = startY + (endY - startY) * randomFloat(-0.2, 0.2);
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const easedT = easeInOutSine(t);
    
    // Cubic Bezier formula
    const x = Math.pow(1 - easedT, 3) * startX +
              3 * Math.pow(1 - easedT, 2) * easedT * controlX1 +
              3 * (1 - easedT) * Math.pow(easedT, 2) * controlX2 +
              Math.pow(easedT, 3) * endX;
              
    const y = Math.pow(1 - easedT, 3) * startY +
              3 * Math.pow(1 - easedT, 2) * easedT * controlY1 +
              3 * (1 - easedT) * Math.pow(easedT, 2) * controlY2 +
              Math.pow(easedT, 3) * endY;
    
    points.push({ x, y });
  }
  
  return points;
}

// QWERTY keyboard layout for typo simulation
const QWERTY_ADJACENT: Record<string, string> = {
  'a': 'sqwz', 'b': 'vghn', 'c': 'xdfv', 'd': 'sxcfre', 'e': 'wrds', 
  'f': 'drtgvc', 'g': 'ftyhbv', 'h': 'gyujnb', 'i': 'uokjl', 'j': 'huikmn',
  'k': 'jiolm', 'l': 'kop', 'm': 'njk', 'n': 'bhjm', 'o': 'ikpl',
  'p': 'ol', 'q': 'wa', 'r': 'etdfg', 's': 'awedxz', 't': 'ryfgh',
  'u': 'yihj', 'v': 'cfgb', 'w': 'qeas', 'x': 'zsdc', 'y': 'tughj', 'z': 'asx'
};

export function generateHumanizationScript(config: HumanizationConfig = DEFAULT_CONFIG): string {
  const mouseSpeedMultiplier = config.mouseSpeed === 'slow' ? 1.5 : config.mouseSpeed === 'fast' ? 0.7 : 1;
  const typingSpeedMultiplier = config.typingSpeed === 'slow' ? 1.5 : config.typingSpeed === 'fast' ? 0.7 : 1;
  
  return `
    // ============================================
    // Human Behavior Simulation
    // ============================================
    
    (function() {
      const config = {
        mouseSpeed: ${mouseSpeedMultiplier},
        typingSpeed: ${typingSpeedMultiplier},
        enableMicroPauses: ${config.enableMicroPauses},
        enableTypos: ${config.enableTypos}
      };
      
      let lastMousePosition = { x: 0, y: 0 };
      let mouseMovementHistory = [];
      const MAX_HISTORY = 50;
      
      // Track mouse movements for pattern analysis
      document.addEventListener('mousemove', (e) => {
        mouseMovementHistory.push({
          x: e.clientX,
          y: e.clientY,
          timestamp: Date.now()
        });
        
        if (mouseMovementHistory.length > MAX_HISTORY) {
          mouseMovementHistory.shift();
        }
        
        lastMousePosition = { x: e.clientX, y: e.clientY };
      }, { passive: true });
      
      // Random idle mouse movements
      function simulateIdleMouseMovement() {
        if (Math.random() > 0.95) { // 5% chance every interval
          const currentX = lastMousePosition.x;
          const currentY = lastMousePosition.y;
          
          const deltaX = (Math.random() - 0.5) * 50;
          const deltaY = (Math.random() - 0.5) * 50;
          
          const newX = Math.max(0, Math.min(window.innerWidth, currentX + deltaX));
          const newY = Math.max(0, Math.min(window.innerHeight, currentY + deltaY));
          
          // Dispatch synthetic mouse move
          const event = new MouseEvent('mousemove', {
            clientX: newX,
            clientY: newY,
            bubbles: true
          });
          document.dispatchEvent(event);
        }
      }
      
      // Simulate micro-pauses during typing
      const originalAddEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (type === 'keydown' || type === 'keypress') {
          const wrappedListener = function(event) {
            if (config.enableMicroPauses && Math.random() > 0.9) {
              // 10% chance of micro-pause (50-150ms)
              const pauseDuration = 50 + Math.random() * 100;
              setTimeout(() => {
                listener.call(this, event);
              }, pauseDuration);
            } else {
              listener.call(this, event);
            }
          };
          return originalAddEventListener.call(this, type, wrappedListener, options);
        }
        return originalAddEventListener.call(this, type, listener, options);
      };
      
      // Add natural variance to setTimeout/setInterval
      const originalSetTimeout = window.setTimeout;
      window.setTimeout = function(callback, delay, ...args) {
        if (delay && delay > 100) {
          // Add ±5% variance to delays > 100ms
          const variance = delay * 0.05;
          const adjustedDelay = delay + (Math.random() * variance * 2 - variance);
          return originalSetTimeout.call(this, callback, adjustedDelay, ...args);
        }
        return originalSetTimeout.call(this, callback, delay, ...args);
      };
      
      // Simulate reading behavior with eye tracking patterns
      function simulateReadingPattern() {
        const paragraphs = document.querySelectorAll('p, article, .content');
        if (paragraphs.length === 0) return;
        
        const targetParagraph = paragraphs[Math.floor(Math.random() * paragraphs.length)];
        const rect = targetParagraph.getBoundingClientRect();
        
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          // Simulate F-pattern reading (common web reading pattern)
          const startX = rect.left + 20;
          const startY = rect.top + 20;
          
          // Horizontal scan
          for (let i = 0; i < 3; i++) {
            const y = startY + i * 30;
            const endX = rect.left + rect.width * (0.6 + Math.random() * 0.3);
            
            // Simulate eye movement (fast, no actual mouse move)
            // This is just for timing simulation
          }
        }
      }
      
      // Start idle behaviors
      setInterval(simulateIdleMouseMovement, 2000 + Math.random() * 3000);
      setInterval(simulateReadingPattern, 5000 + Math.random() * 5000);
      
      // Add random scroll micro-adjustments
      let lastScrollTime = Date.now();
      window.addEventListener('scroll', () => {
        lastScrollTime = Date.now();
      }, { passive: true });
      
      setInterval(() => {
        const timeSinceScroll = Date.now() - lastScrollTime;
        if (timeSinceScroll > 3000 && Math.random() > 0.95) {
          // Small scroll adjustment after 3s of no scrolling
          window.scrollBy({
            top: (Math.random() - 0.5) * 20,
            behavior: 'smooth'
          });
        }
      }, 1000);
      
      // Simulate occasional focus changes
      setInterval(() => {
        if (Math.random() > 0.98) {
          // Blur and refocus to simulate user looking away
          if (document.activeElement && document.activeElement !== document.body) {
            document.activeElement.blur();
            setTimeout(() => {
              if (document.activeElement === document.body) {
                const focusableElements = document.querySelectorAll('input, textarea, button, a');
                if (focusableElements.length > 0) {
                  const randomElement = focusableElements[Math.floor(Math.random() * focusableElements.length)];
                  randomElement.focus();
                }
              }
            }, 500 + Math.random() * 1000);
          }
        }
      }, 5000);
      
      console.log('[Humanization] Behavior simulation active');
    })();
  `;
}
