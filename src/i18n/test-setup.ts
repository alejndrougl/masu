// Las pruebas comparan textos en español: se simula un navegador en español.
import { vi } from 'vitest';

vi.stubGlobal('navigator', { language: 'es-MX', languages: ['es-MX', 'es'] });
