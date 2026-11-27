import type { ReactNode } from 'react';
import type { Mode } from '../state/store';

/** Símbolos propios: círculo, cuadrado y línea, a la manera de un emblema. */
const MARKS: Record<Mode | 'tema', ReactNode> = {
  lectura: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <circle className="f" cx="12" cy="12" r="4" />
    </>
  ),
  lienzo: (
    <>
      <rect x="5" y="3" width="14" height="18" />
      <rect className="f" x="14" y="16" width="5.8" height="5.8" />
    </>
  ),
  cuadros: (
    <>
      <rect className="f" x="3" y="3" width="8" height="8" />
      <rect className="f" x="13" y="3" width="8" height="8" />
      <rect className="f" x="3" y="13" width="8" height="8" />
      <rect x="13.8" y="13.8" width="6.4" height="6.4" />
    </>
  ),
  valores: (
    <>
      <rect className="f" x="3" y="4" width="4.5" height="16" opacity="0.2" />
      <rect className="f" x="7.5" y="4" width="4.5" height="16" opacity="0.45" />
      <rect className="f" x="12" y="4" width="4.5" height="16" opacity="0.72" />
      <rect className="f" x="16.5" y="4" width="4.5" height="16" />
    </>
  ),
  color: (
    <>
      <circle cx="12" cy="8.4" r="6" />
      <circle cx="8" cy="15.2" r="6" />
      <circle cx="16" cy="15.2" r="6" />
    </>
  ),
  sujetos: (
    <>
      <circle cx="12" cy="12" r="9.2" />
      <circle className="f" cx="8.6" cy="10.4" r="1.5" />
      <circle className="f" cx="15.4" cy="10.4" r="1.5" />
      <path d="M8.5 15.6h7" />
    </>
  ),
  composicion: (
    <>
      <rect x="2.5" y="6" width="19" height="11.75" />
      <path d="M2.5 17.75A11.75 11.75 0 0 1 14.25 6A7.25 7.25 0 0 1 21.5 13.25A4.5 4.5 0 0 1 17 17.75A2.75 2.75 0 0 1 14.25 15A1.75 1.75 0 0 1 16 13.25" />
    </>
  ),
  perspectiva: (
    <>
      <path d="M2 10H22M2.5 21L12 10L21.5 21M8.5 21L12 10L15.5 21" />
      <circle className="f" cx="12" cy="10" r="2.3" />
    </>
  ),
  luz: (
    <>
      <circle cx="8" cy="8" r="3.2" />
      <path d="M8 1.6V3M1.6 8H3M3.5 3.5L4.5 4.5M12.5 3.5L11.5 4.5M3.5 12.5L4.5 11.5" />
      <path d="M12 10.2L20.5 15.6M10.2 12L15.6 20.5M12.6 12.6L20 20" />
    </>
  ),
  construccion: (
    <>
      <circle cx="12" cy="6" r="3.7" />
      <ellipse cx="12" cy="12.8" rx="5.6" ry="1.9" />
      <path d="M6.4 12.8V19.6C6.4 20.7 8.9 21.6 12 21.6S17.6 20.7 17.6 19.6V12.8" />
    </>
  ),
  figuras: (
    <>
      <path d="M3 8V3H8M16 3H21V8M21 16V21H16M8 21H3V16" />
      <circle className="f" cx="12" cy="9" r="3.2" />
      <path className="f" d="M6.5 19C6.5 15 8.7 13 12 13S17.5 15 17.5 19Z" />
    </>
  ),
  encaje: (
    <>
      <path d="M7 3.5L18.5 6L21 15L13 20.8L4 16Z" />
      <g className="f">
        <circle cx="7" cy="3.5" r="1.8" />
        <circle cx="18.5" cy="6" r="1.8" />
        <circle cx="21" cy="15" r="1.8" />
        <circle cx="13" cy="20.8" r="1.8" />
        <circle cx="4" cy="16" r="1.8" />
      </g>
    </>
  ),
  simplificar: (
    <>
      <path className="f" d="M7 2.8L12 11.4H2Z" />
      <circle cx="17" cy="7.2" r="4.2" />
      <rect className="f" x="8" y="14" width="8" height="8" />
    </>
  ),
  pintar: (
    <>
      <path d="M20.8 3.2L11 13" strokeWidth="3.2" />
      <path className="f" d="M9.3 12C6.9 12.2 5.5 13.7 5.2 15.6C5 17.1 4.3 18.2 2.5 19C4.9 20.6 8.5 20.3 10.6 18.4C12.2 16.9 12.3 15 11 13.8Z" />
    </>
  ),
  tema: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path className="f" d="M12 3.5A8.5 8.5 0 0 1 12 20.5Z" />
    </>
  ),
};

export function Mark({ name }: { name: keyof typeof MARKS }) {
  return (
    <svg className="mark" viewBox="0 0 24 24" aria-hidden>
      {MARKS[name]}
    </svg>
  );
}
