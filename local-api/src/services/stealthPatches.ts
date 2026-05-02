// Enhanced stealth patches for better anti-detection
// These patches are injected into the browser context to hide automation traces

export function generateStealthPatches(options: {
  locale: string;
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number;
  hasTouch: boolean;
  fonts: string[];
  plugins: Array<{ name: string; filename: string; description: string }>;
  webgl?: {
    vendor: string;
    renderer: string;
    maxTextureSize: number;
    maxViewportDimensions: [number, number];
  };
  canvasNoiseSeed: string;
}): string {
  const { locale, platform, hardwareConcurrency, deviceMemory, hasTouch, fonts, plugins, webgl, canvasNoiseSeed } = options;
  
  return `
    // ============================================
    // MODULE 1: Navigator Properties
    // ============================================
    
    // Fix navigator.hardwareConcurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      enumerable: true,
      get: () => ${hardwareConcurrency}
    });
    
    // Fix navigator.deviceMemory
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      enumerable: true,
      get: () => ${deviceMemory}
    });
    
    // Fix navigator.languages (must match locale)
    const baseLanguage = '${locale}'.split('-')[0];
    Object.defineProperty(navigator, 'languages', {
      configurable: true,
      enumerable: true,
      get: () => ['${locale}', baseLanguage, 'en']
    });
    
    // Fix navigator.platform
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      enumerable: true,
      get: () => '${platform}'
    });
    
    // Fix navigator.maxTouchPoints
    Object.defineProperty(navigator, 'maxTouchPoints', {
      configurable: true,
      enumerable: true,
      get: () => ${hasTouch ? 5 : 0}
    });
    
    // ============================================
    // MODULE 2: Plugins
    // ============================================
    
    const pluginsData = ${JSON.stringify(plugins)};
    
    Object.defineProperty(navigator, 'plugins', {
      configurable: true,
      enumerable: true,
      get: () => {
        const pluginArray = pluginsData.map((p, index) => ({
          name: p.name,
          filename: p.filename,
          description: p.description,
          length: 1,
          item: (i) => i === 0 ? { type: 'application/pdf', suffixes: 'pdf', description: p.description } : null,
          namedItem: (name) => name === 'application/pdf' ? { type: 'application/pdf', suffixes: 'pdf', description: p.description } : null,
          [index]: { type: 'application/pdf', suffixes: 'pdf', description: p.description }
        }));
        
        pluginArray.item = (i) => pluginArray[i] || null;
        pluginArray.namedItem = (name) => pluginArray.find(p => p.name === name) || null;
        pluginArray.refresh = () => {};
        
        return pluginArray;
      }
    });
    
    // ============================================
    // MODULE 3: Permissions API
    // ============================================
    
    const originalQuery = Permissions.prototype.query;
    Permissions.prototype.query = function(params) {
      // Return realistic permission states
      if (params.name === 'notifications') {
        return Promise.resolve({ state: 'prompt', onchange: null });
      }
      if (params.name === 'geolocation') {
        return Promise.resolve({ state: 'prompt', onchange: null });
      }
      if (params.name === 'camera' || params.name === 'microphone') {
        return Promise.resolve({ state: 'prompt', onchange: null });
      }
      return originalQuery.call(this, params);
    };
    
    // ============================================
    // MODULE 4: WebGL Fingerprinting
    // ============================================
    
    ${webgl ? `
    const webglData = ${JSON.stringify(webgl)};
    
    const patchWebGL = (proto) => {
      if (!proto) return;
      
      const originalGetParameter = proto.getParameter;
      proto.getParameter = function(parameter) {
        const UNMASKED_VENDOR_WEBGL = 37445;
        const UNMASKED_RENDERER_WEBGL = 37446;
        
        if (parameter === UNMASKED_VENDOR_WEBGL) return webglData.vendor;
        if (parameter === UNMASKED_RENDERER_WEBGL) return webglData.renderer;
        if (parameter === 3379) return webglData.maxTextureSize;
        if (parameter === 3386) return new Int32Array(webglData.maxViewportDimensions);
        
        return originalGetParameter.call(this, parameter);
      };
      
      const originalGetExtension = proto.getExtension;
      proto.getExtension = function(name) {
        const ext = originalGetExtension.call(this, name);
        if (name === 'WEBGL_debug_renderer_info') {
          return {
            UNMASKED_VENDOR_WEBGL: 37445,
            UNMASKED_RENDERER_WEBGL: 37446
          };
        }
        return ext;
      };
    };
    
    patchWebGL(WebGLRenderingContext?.prototype);
    patchWebGL(WebGL2RenderingContext?.prototype);
    ` : ''}
    
    // ============================================
    // MODULE 5: Canvas Fingerprinting
    // ============================================
    
    const canvasSeed = '${canvasNoiseSeed}';
    let currentSeed = Math.abs(canvasSeed.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0));
    
    const pseudoRandom = () => {
      currentSeed = (currentSeed * 9301 + 49297) % 233280;
      return currentSeed / 233280;
    };
    
    const addCanvasNoise = (canvas) => {
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.width || !canvas.height) return;
      
      try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const shift = {
          r: Math.floor(pseudoRandom() * 10) - 5,
          g: Math.floor(pseudoRandom() * 10) - 5,
          b: Math.floor(pseudoRandom() * 10) - 5,
          a: Math.floor(pseudoRandom() * 10) - 5
        };
        
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = imageData.data[i] + shift.r;
          imageData.data[i + 1] = imageData.data[i + 1] + shift.g;
          imageData.data[i + 2] = imageData.data[i + 2] + shift.b;
          imageData.data[i + 3] = imageData.data[i + 3] + shift.a;
        }
        
        ctx.putImageData(imageData, 0, 0);
      } catch (e) {
        // Ignore errors
      }
    };
    
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function(...args) {
      addCanvasNoise(this);
      return originalToDataURL.apply(this, args);
    };
    
    const originalToBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(...args) {
      addCanvasNoise(this);
      return originalToBlob.apply(this, args);
    };
    
    // ============================================
    // MODULE 6: Font Fingerprinting
    // ============================================
    
    const availableFonts = ${JSON.stringify(fonts)};
    
    const originalMeasureText = CanvasRenderingContext2D.prototype.measureText;
    CanvasRenderingContext2D.prototype.measureText = function(...args) {
      const result = originalMeasureText.apply(this, args);
      const shift = pseudoRandom() * 0.001;
      
      Object.defineProperty(result, 'width', {
        configurable: true,
        enumerable: true,
        get: () => result.width + shift
      });
      
      return result;
    };
    
    // ============================================
    // MODULE 7: AudioContext Fingerprinting
    // ============================================
    
    if (window.AudioBuffer) {
      const originalGetChannelData = AudioBuffer.prototype.getChannelData;
      AudioBuffer.prototype.getChannelData = function(...args) {
        const data = originalGetChannelData.apply(this, args);
        for (let i = 0; i < data.length; i += 100) {
          data[i] = data[i] + pseudoRandom() * 0.00001;
        }
        return data;
      };
    }
    
    // ============================================
    // MODULE 8: Chrome Runtime (Deep Leak Fix)
    // ============================================
    
    if (!window.chrome) {
      window.chrome = {};
    }
    
    window.chrome.runtime = {
      OnInstalledReason: {
        CHROME_UPDATE: "chrome_update",
        INSTALL: "install",
        SHARED_MODULE_UPDATE: "shared_module_update",
        UPDATE: "update"
      },
      OnRestartRequiredReason: {
        APP_UPDATE: "app_update",
        OS_UPDATE: "os_update",
        PERIODIC: "periodic"
      },
      PlatformArch: {
        ARM: "arm",
        ARM64: "arm64",
        MIPS: "mips",
        MIPS64: "mips64",
        X86_32: "x86_32",
        X86_64: "x86_64"
      },
      PlatformOs: {
        ANDROID: "android",
        CROS: "cros",
        LINUX: "linux",
        MAC: "mac",
        OPENBSD: "openbsd",
        WIN: "win"
      },
      RequestUpdateCheckStatus: {
        NO_UPDATE: "no_update",
        THROTTLED: "throttled",
        UPDATE_AVAILABLE: "update_available"
      }
    };
    
    window.chrome.loadTimes = function() {
      return {
        requestTime: performance.timing.navigationStart / 1000,
        startLoadTime: performance.timing.navigationStart / 1000,
        commitLoadTime: performance.timing.responseStart / 1000,
        finishDocumentLoadTime: performance.timing.domContentLoadedEventEnd / 1000,
        finishLoadTime: performance.timing.loadEventEnd / 1000,
        firstPaintTime: performance.timing.domInteractive / 1000,
        firstPaintAfterLoadTime: 0,
        navigationType: "Other",
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: "h2",
        wasAlternateProtocolAvailable: false,
        connectionInfo: "h2"
      };
    };
    
    window.chrome.csi = function() {
      return {
        startE: performance.timing.navigationStart,
        onloadT: performance.timing.domContentLoadedEventEnd,
        pageT: performance.timing.loadEventEnd - performance.timing.navigationStart,
        tran: 15
      };
    };
    
    // ============================================
    // MODULE 9: Client Hints
    // ============================================
    
    if (navigator.userAgentData) {
      const isMobile = ${hasTouch};
      const platformName = '${platform}'.includes('Win') ? 'Windows' : '${platform}'.includes('Mac') ? 'macOS' : 'Android';
      
      Object.defineProperty(navigator.userAgentData, 'mobile', {
        configurable: true,
        enumerable: true,
        get: () => isMobile
      });
      
      Object.defineProperty(navigator.userAgentData, 'platform', {
        configurable: true,
        enumerable: true,
        get: () => platformName
      });
    }
    
    // ============================================
    // Stealth patches applied successfully
    // ============================================
  `;
}
