import { describe, expect, it } from 'vitest';
import { heldDrawings, honestSubjects } from './honest';
import type { Subject } from './types';

const subject = (kind: Subject['kind'], box: [number, number, number, number], score = 0.9, label: string = kind): Subject => ({ id: label, kind, label, score, box: { x: box[0], y: box[1], w: box[2], h: box[3] } });

describe('sujetos que se pueden afirmar', () => {
  it('un objeto poco seguro no se nombra; uno probable sí', () => {
    const out = honestSubjects([subject('object', [0.1, 0.1, 0.2, 0.2], 0.3, 'Mochila'), subject('object', [0.5, 0.1, 0.2, 0.2], 0.7, 'Paraguas')]);
    expect(out.map((s) => s.label)).toEqual(['Paraguas']);
  });

  it('una mano dentro de un perro es su pata', () => {
    const out = honestSubjects([subject('animal', [0, 0, 1, 1], 0.9, 'Perro'), subject('hand', [0.6, 0.7, 0.1, 0.1], 0.9, 'Mano')]);
    expect(out.map((s) => s.label)).toEqual(['Perro']);
  });

  it('una mano junto a una persona y un perro sigue siendo mano', () => {
    const out = honestSubjects([subject('animal', [0, 0, 1, 1]), subject('person', [0.4, 0.2, 0.5, 0.8], 0.9, 'Persona'), subject('hand', [0.6, 0.6, 0.1, 0.1], 0.9, 'Mano')]);
    expect(out.some((s) => s.label === 'Mano')).toBe(true);
  });

  it('una carita chica tan cerca como el rostro principal es un dibujo sostenido; una lejana es alguien del fondo', () => {
    const list = [
      subject('anime-face', [0.28, 0.0, 0.22, 0.3], 0.9, 'principal'),
      subject('anime-face', [0.44, 0.9, 0.06, 0.06], 0.6, 'boceto'),
      subject('anime-person', [0.36, 0.8, 0.2, 0.2], 0.5, 'cuerpo del boceto'),
      subject('anime-face', [0.55, 0.14, 0.03, 0.03], 0.7, 'alumno'),
    ];
    // El cuaderno está abajo y cerca (0.9); el aula, lejos (0.2); la cara principal a 0.7.
    const depth = (_x: number, y: number) => (y > 0.75 ? 0.9 : y < 0.35 && _x > 0.52 ? 0.2 : 0.7);
    const gone = heldDrawings(list, depth);
    expect([...gone].sort()).toEqual(['boceto', 'cuerpo del boceto']);
  });
});
