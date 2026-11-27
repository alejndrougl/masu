# Fuentes consultadas

## Qué se aprendió y dónde se usó

La investigación sirvió para decidir cómo construir Masu, no para juntar una cifra. Esto es lo que cambió de verdad en la aplicación:

| Lo que se aprendió | De dónde | Dónde quedó |
| --- | --- | --- |
| El dibujo se arma de lo grande a lo chico: gesto, masas de cabeza, tórax y pelvis, y después el detalle | [Line of Action: cabeza, tórax y pelvis](https://line-of-action.com/gesture-basics-2-torso-and-hips/), [Proko: el block-in](https://www.proko.com/lesson/angles-enveloping-and-the-block-in) | Los diez niveles de Construcción (`ui/overlays.ts`) |
| Encajar primero en rectas y luego curvar | [El método Bargue](https://artistsnetwork.com/art-mediums/drawing/the-bargue-method-at-the-academy-of-realist-art) | Niveles 7 y 8, y el encaje de una escena |
| Un volumen se explica con líneas que le dan la vuelta; el peso de línea va donde una forma tapa a otra | [Drawabox, lección 5](https://www.drawabox.com/lesson/5), [Lección 2: líneas de contorno](https://drawabox.com/community/submission/CN0PK5G2) | Cintas y traslapes de `lib/surface.ts`, trazo en `ui/surface-draw.ts` |
| El tórax y la pelvis se bloquean con la figura que dé la pose, no siempre con un óvalo, y la flecha del movimiento encadena las formas | Tus referencias de construcción de figuras dinámicas | Biblioteca de figuras y flujo del movimiento (`lib/shapes.ts`, `ui/overlays.ts`) |
| Pintar primero en masas de valor | [El valor del notan](https://www.artistsnetwork.com/art-mediums/pastel/the-value-of-notan/amp) | Masas de una escena (`lib/scene.ts`) |
| La malla de un cuerpo se puede recuperar de una imagen y guiar con puntos | [PromptHMR](https://arxiv.org/html/2504.06397v1), [mallas de cuerpo parcialmente visible](https://arxiv.org/pdf/2407.09694) | La superficie real del cuerpo, y usar solo las partes que se ven para guiar el recorte (`state/engine.ts`) |
| Los puntos que se dan a SAM deciden lo que recorta | [SAMAug](https://arxiv.org/pdf/2307.01187), [SAMRefiner](https://arxiv.org/pdf/2502.06756) | Recorte guiado por la malla y juzgado contra ella (`lib/refine.ts`) |
| Un trazo es geometría y semántica a la vez | [Líneas que transmiten geometría y semántica](https://arxiv.org/abs/2203.12691) | Línea artística más profundidad para separar figura y fondo |
| Las fugas son una geometría que se puede comprobar | [Puntos de fuga en mundo Manhattan](https://arxiv.org/pdf/2505.04788), [Fugas con gravedad previa](https://arxiv.org/pdf/2308.10694) | Tres direcciones ortogonales en `lib/perspective.ts`; la profundidad como juez es propia |
| Las rectas se doblan con el lente, y esa curva se puede estimar | [Rectificación con rectas](https://arxiv.org/pdf/2003.11386), [Peter Han: ojo de pez](https://www.proko.com/lesson/fish-eye-perspective-with-peter-han), [guía de 5 puntos](https://docs.toonboom.com/help/storyboard-pro-7/drawing/edit-5-points-perspective-fisheye-guide.html) | Lente en `lib/lens.ts` y abanico curvo |
| El contorno de una figura dice cuántas luces hay y por dónde entran; el interior, qué tan de frente vienen | [López-Moreno y otros: varias luces en una sola imagen](https://graphics.unizar.es/papers/CGF2013_lr.pdf), [Componer imágenes detectando la luz](https://graphics.unizar.es/papers/CG2010_light_detection.pdf), [Johnson y Farid: luz y contorno](https://people.csail.mit.edu/kimo/publications/lighting/lighting.html) | Modo Luz: `lib/light.ts` ajusta contorno e interior juntos, con normales de la malla o de la silueta inflada |
| En el borde de la figura la normal no siempre está en el plano de la imagen, y eso sesga la luz | [Kee, O'Brien y Farid](https://farid.berkeley.edu/downloads/publications/tog14.pdf) | La orilla no entra al ajuste de la luz principal; solo se usa para el contraluz |
| Terminador, sombra propia, sombra arrojada, oclusión, luz reflejada y brillo son cosas distintas, y la sombra arrojada es la más oscura y la de borde más duro cerca de quien la proyecta | [Proko: luz y forma](https://www.proko.com/lesson/shading-light-and-form-basics), [Muddy Colors: anatomía de las sombras](https://muddycolors.com/2022/07/color-theory-part-9-the-anatomy-of-shadows), [Gurney: luz y forma](https://gurneyjourney.blogspot.ch/2010/02/light-and-form-part-1_15.html) | Zonas del modo Luz y los consejos de "Cómo pintarla" |
| Un pliegue se nombra por lo que lo causa: un punto que tira, una articulación que aprieta, la vuelta a un cilindro o el peso | [Proko: repaso de los 7 pliegues](https://www.proko.com/lesson/a-review-of-the-7-folds), [Tubo y pañal](https://www.proko.com/course-lesson/intro-to-pipe-folds-and-diaper-folds), [Media llave y espiral](https://www.proko.com/lesson/half-lock-and-spiral-folds-in-action) | Pliegues de la ropa en Construcción (`lib/folds.ts`) |
| Una capa se resuelve marcando de dónde cuelga, el borde de abajo como un ocho, y uniendo un extremo con el otro | El video de capas y túnicas que transcribiste | Borde de la tela suelta y uniones punteadas (`lib/folds.ts`) |
| La cara necesita un pase de anatomía: qué es hueso y qué se estira o se aplasta | El video de caras que transcribiste | Métodos de cabeza Cráneo y Músculos (`lib/heads.ts`) |
| Con pocos minutos solo cabe postura, forma y gesto, y eso es lo que entrena | El video de poses rápidas que transcribiste, [Line of Action](https://line-of-action.com/) | Pose rápida con reloj en Construcción (`ui/QuickPose.tsx`) |

Lo que no salió de una fuente, sino de probar con las imágenes de `ejemplos/`:

- Una parte que la pose casi no vio no puede guiar el recorte: un brazo supuesto llevaba el recorte hasta una silla.
- La profundidad separa lo que el color no separa: una ventana junto al pelo está mucho más lejos que la figura.
- Lo que una figura sostiene sale de sus manos; lo corto y delgado pegado a otro lado, como una letra, es un resto.
- Un dibujo a línea hay que seguirlo por el centro de la tinta, o cada trazo se vuelve dos.

Lo que salió de probar el modo Luz con `ejemplos/`:

- La textura de un traje no es sombra: la claridad se promedia por hacia dónde mira la forma antes de buscar la luz.
- El pelo negro o el lomo oscuro de un perro imitan una luz desde abajo: solo se acepta si ninguna luz de arriba explica casi lo mismo.
- La sombra de algo blanco toma color (el vestido de Monet es azul en sombra); un negro junto a un color es otro material.
- En un lugar la profundidad no alcanza para decir de dónde viene la luz: ahí solo se afirma el lado más claro del cielo.

Sobre la lista de 350 títulos que venía en tu mega prompt: son libros y cursos reales en su mayoría, pero no los abrí uno por uno, así que no los cuento como consultados. Lo que de verdad se leyó para este cambio está en la tabla de arriba.

## La lista completa

Lista generada del historial real de búsquedas, no escrita a mano. **Importante:** casi todas se leyeron como resultado de búsqueda, es decir, el fragmento relevante que devuelve el buscador, no la página completa. Una aparición aquí significa que salió y se revisó ese fragmento, no que se haya estudiado entera.

Búsquedas hechas: 109. Páginas únicas en las tres categorías: 623.

| Categoría | Páginas únicas | Sitios distintos |
| --- | --- | --- |
| Foros y sitios de dibujo | 243 | 24 |
| Foros, repositorios y documentación de programación | 168 | 22 |
| Artículos científicos | 212 | 20 |

Límites de esta lista:

- Las 243 páginas de dibujo salen de pocos foros grandes (Proko, Drawabox, WetCanvas, New Masters Academy, Line of Action, Polycount, Crimson Daggers, Cubebrush). Son muchos hilos, no cien foros distintos.
- Stack Overflow rechaza a la herramienta de búsqueda, así que no aparece. Los foros técnicos que sí respondieron son sobre todo issues de GitHub, Blender Artists, los foros de Epic y el de McNeel.
- Quedaron fuera 565 resultados sin clasificar: mezcla de tutoriales (como Clip Studio Tips), patentes, tiendas, cursos y sitios de relleno. Algunos sí eran útiles, pero no se contaron para no inflar las cifras.

## Foros y sitios de dibujo

### proko.com (64)

- [A Review of The 7 Folds](https://www.proko.com/lesson/a-review-of-the-7-folds)
- [Anatomy Critiques – The Pelvis](https://proko.com/course-lesson/anatomy-critiques-the-pelvis)
- [Angles, Enveloping & the Block-In](https://www.proko.com/lesson/angles-enveloping-and-the-block-in)
- [Angles, Enveloping & the Block-In](https://www.proko.com/course-lesson/angles-enveloping-and-the-block-in)
- [animal anatomy](https://www.proko.com/community/topics/animal-anatomy)
- [Construction Drawing Critique](https://proko.com/community/topics/construction-drawing)
- [Could someone please check my work?](https://proko.com/community/topics/could-someone-please-check-my-work)
- [Critique - Why You Need to be Drawing with Grids](https://www.proko.com/course-lesson/critique-why-you-need-to-be-drawing-with-grids)
- [Figure drawing critique](https://proko.com/community/topics/figure-drawing-critique-3)
- [Fish-Eye Perspective with Peter Han](https://www.proko.com/lesson/fish-eye-perspective-with-peter-han)
- [Five-Point Perspective Explained](https://www.proko.com/course-lesson/five-point-perspective-explained)
- [Half Lock and Spiral Folds in Action](https://www.proko.com/lesson/half-lock-and-spiral-folds-in-action)
- [Half Lock and Spiral Folds in Action](https://www.proko.com/course-lesson/half-lock-and-spiral-folds-in-action)
- [How to Draw Eyes – Anatomy and Structure](https://www.proko.com/how-to-draw-eyes-structure/)
- [How to Draw Hands from IMAGINATION – Step-by-Step](https://proko.com/lesson/how-to-draw-hands-from-imagination-step-by-step)
- [How to Draw the Head – Front View](https://www.proko.com/course-lesson/how-to-draw-the-head-front-view/notes)
- [How to Draw the Head – Front View](https://www.proko.com/course-lesson/how-to-draw-the-head-front-view/)
- [How to Sculpt the Loomis Head](https://www.proko.com/course-lesson/how-to-sculpt-the-loomis-head/notes)
- [Intro to Pipe folds and Diaper Folds](https://www.proko.com/course-lesson/intro-to-pipe-folds-and-diaper-folds)
- [Jeanne Bowman](https://www.proko.com/@jeanneillustrates)
- [Locating the Pelvis - Practice Reel 1](https://www.proko.com/course-lesson/locating-the-pelvis-practice-reel-1)
- [Need Advice on Drawing Heads! Help Greatly Appreciated](https://proko.com/community/topics/need-advice-on-drawing-heads-help-greatly-appreciated)
- [On Courses + Tools](https://proko.com/community/topics/figure-drawing-feedback-1)
- [On Courses + Tools](https://proko.com/community/topics/help-with-robo-bean)
- [On Courses + Tools](https://www.proko.com/community/topics/please-can-anyone-critique-1)
- [On Courses + Tools use code BLACK20](https://proko.com/@brevittyy)
- [On Courses + Tools use code BLACK20](https://proko.com/@violadm)
- [Pelvis Assignment Example 1](https://www.proko.com/course-lesson/pelvis-assignment-example-1/notes)
- [Practical Guide to Realistic Shading](https://proko.com/880)
- [Proko - Anatomy critique wanted](https://www.proko.com/community/topics/anatomy-critique-wanted)
- [Proko - Construction exercise](https://www.proko.com/community/topics/construction-exercise)
- [Proko - Critique Request](https://www.proko.com/community/topics/critique-request)
- [Proko - Draw ANY Head Type with the Loomis Method](https://www.proko.com/course-lesson/draw-any-head-type-with-the-loomis-method-part-2)
- [Proko - Figure Drawing critique](https://www.proko.com/community/topics/figure-drawing-critique)
- [Proko - Figure Drawing Critiques](https://www.proko.com/course-lesson/figure-drawing-critiques-mannequinization)
- [Proko - Head anatomy looking for critique](https://www.proko.com/community/topics/head-anatomy-looking-for-critique)
- [Proko - Head Proportions Made Easy](https://www.proko.com/course-lesson/head-proportions-made-easy)
- [Proko - How to Draw and Shade the Human Torso](https://www.proko.com/course-lesson/how-to-draw-and-shade-the-human-torso/)
- [Proko - How to Draw the Head](https://www.proko.com/course-lesson/how-to-draw-the-head-front-view/assignments)
- [Proko - How to Draw the Head from Any Angle](https://www.proko.com/course-lesson/how-to-draw-the-head-from-any-angle)
- [Proko - Intuitive Portrait Sketching with the Loomis Method](https://www.proko.com/course-lesson/intuitive-portrait-sketching-with-the-loomis-method-part-3)
- [Proko - Landmarks of the Human Body](https://www.proko.com/course-lesson/landmarks-of-the-human-body/)
- [Proko - Loomis Head - Block In Demo](https://www.proko.com/course-lesson/loomis-head-block-in-demo)
- [Proko - Loomis Method](https://www.proko.com/course-lesson/loomis-method-real-time-demo/discussions)
- [Proko - Loomis Method Front View](https://www.proko.com/course-lesson/loomis-method-front-view-real-time-demo)
- [Proko - Mannequinization](https://www.proko.com/course-lesson/mannequinization-structure-of-the-human-body/)
- [Proko - Proportions Critique and Advanced Chart Drawing](https://www.proko.com/course-lesson/proportions-critique-and-advanced-chart-drawing)
- [Proko - Torso anatomy and rotating the mannequin](https://www.proko.com/community/topics/torso-anatomy-and-rotating-the-mannequin)
- [proko.com](https://www.proko.com/@cchapman3)
- [proko.com](https://www.proko.com/course-lesson/practical-guide-to-realistic-shading/notes)
- [proko.com](https://www.proko.com/course-lesson/project-shadow-mapping/notes)
- [Shading Light and Form – Basics](https://www.proko.com/lesson/shading-light-and-form-basics)
- [Shading Light and Form – Basics](https://www.proko.com/course-lesson/shading-light-and-form-basics)
- [Simple Structures of the Hands Part 2](https://www.proko.com/course-lesson/simple-structures-of-the-hands-part-2)
- [Spiral Folds](https://www.proko.com/lesson/spiral-folds)
- [Spiral Folds](https://www.proko.com/course-lesson/spiral-folds)
- [Step by Step Workflow for Figures: Side View](https://proko.com/course-lesson/step-by-step-workflow-for-figures-side-view)
- [suyash shenai](https://www.proko.com/@suyashshenai)
- [the bean proko s figure fundamentals all critique and feedback are appreciated](https://www.proko.com/community/topics/the-bean-proko-s-figure-fundamentals-all-critique-and-feedback-are-appreciated)
- [Utkarsh Phutela](https://www.proko.com/@utkarshp023)
- [What's in Premium?](https://proko.com/course-lesson/elements-of-light-and-shadow/notes)
- [www.proko.com](https://www.proko.com/@miaowen)
- [www.proko.com](https://www.proko.com/community/topics/pelvis)
- [www.proko.com](https://www.proko.com/profile/tes_k_a/activity)

### drawabox.com (41)

- [2 users agree](https://drawabox.com/community/submission/ZDUXEMD6)
- [drawabox.com](https://drawabox.com/community/submission/VFM1T8EX)
- [drawabox.com](https://drawabox.com/community/submission/0ZTT8PFH)
- [drawabox.com](https://drawabox.com/r/artfundamentals/post/2kt551)
- [drawabox.com](https://drawabox.com/lesson/5/2)
- [drawabox.com](https://drawabox.com/lesson/5/2/recommendations)
- [drawabox.com](https://drawabox.com/community/submission/B8ZY6LT9)
- [drawabox.com](https://drawabox.com/lesson/5/7/FAQ)
- [Drawabox.com](https://drawabox.com/community/submission/DNOYJ8OA/JJ6WS9WM)
- [Drawabox.com](https://drawabox.com/community/submission/NFOELJYU/)
- [Drawabox.com](https://drawabox.com/community/submission/9R4DE3ZA/96GOZ5Z)
- [Drawabox.com](https://drawabox.com/community/submission/GM8I3P50/23WHFE67)
- [Drawabox.com](https://drawabox.com/community/submission/W7X1FW3M)
- [Drawabox.com](https://drawabox.com/community/submission/513SWD6F)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/CN0PK5G2)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/SJQXL8U)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/O0SOE9Z8)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/JDQGV6Z1)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/8P2P41TZ)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/OD0ZO4D9)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/IRXCA07U)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/T6FTRN0Z)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/UF4U1EPM)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/VL8Z3KL)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/SACW0F31)
- [Lesson 2: Contour Lines, Texture and Construction](https://drawabox.com/community/submission/QEN2JWWU)
- [Lesson 5: Applying Construction to Animals](https://drawabox.com/community/submission/TRBT6VA)
- [Lesson 5: Applying Construction to Animals](https://drawabox.com/community/submission/P2H4L1XY)
- [Lesson 5: Applying Construction to Animals](https://drawabox.com/community/submission/JHXFYUSQ)
- [Organic Forms](https://drawabox.com/community/submission/UHF7OBP2)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/post/486pvw)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/post/5w7sf5)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/post/2wpr72)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/post/6wdqgh)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/post/3iuugl)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/post/u80rtd)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/user/uncomfortable/comments/89)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/post/4a17he)
- [Uncomfortable's Advice from /r/ArtFundamentals](https://drawabox.com/r/artfundamentals/user/jeffclc/comments)
- [www.drawabox.com](https://www.drawabox.com/lesson/5)
- [www.drawabox.com](https://www.drawabox.com/lesson/5/1)

### wetcanvas.com (29)

- [A crash course in perspective, for drawing from imagination - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/a-crash-course-in-perspective-for-drawing-from-imagination/)
- [bargue plate size amp method](https://www.wetcanvas.com/forums/topic/bargue-plate-size-amp-method)
- [Basics 101: Class 2 - Foundation of Perspective - Page 10 - WetCanvas](http://www.wetcanvas.com/forums/showthread.php?page=10&t=597782)
- [Basics 101: Class 2 - Foundation of Perspective - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/basics-101-class-2-foundation-of-perspective/)
- [Basics 101: Class 2 - Foundation of Perspective (Archive) - Page 3 - WetCanvas](http://www.wetcanvas.com/forums/archive/index.php/t-597782-p-3.html)
- [basics of figure drawing - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/basics-of-figure-drawing/)
- [Beginner - Landscape/Portrait critique. - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/beginner-landscape-portrait-critique/)
- [Beginner Portrait.....documented - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/beginner-portrait-documented/)
- [Can I get some tips for skin tones? - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/can-i-get-some-tips-for-skin-tones/)
- [cityscape perspective - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/cityscape-perspective/)
- [Drawing from life: Help please: measuring - WetCanvas](http://www.wetcanvas.com/forums/showthread.php?t=814941)
- [ESP - Portrait & Figure Fundamentals - Lesson 3: Measuring - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/esp-portrait-amp-figure-fundamentals-lesson-3-measuring/)
- [ESP - Portrait & Figure Fundamentals - Lesson 5: The Figure, Part 1 - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/esp-portrait-amp-figure-fundamentals-lesson-5-the-figure-part-1/)
- [Flesh and Skin Tones - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/flesh-and-skin-tones/)
- [How to draw perfect curve lines? - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/how-to-draw-perfect-curve-lines-1/)
- [Level 0 Beginner Pencil Drawing - Some Questions - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/level-0-beginner-pencil-drawing-some-questions/)
- [Matching colour to value - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/matching-colour-to-value/)
- [Mixing colours before you paint - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/mixing-colours-before-you-paint/)
- [MUNSELL´s SCALE SYSTEM - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/munsell-s-scale-system/)
- [Neutralizing color - WetCanvas: Online Living for Artists](https://wetcanvas.com/forums/archive/index.php/t-554681.html)
- [Painting "Fundamentals" for the Advanced Artist - WetCanvas: Online Living for Artists](https://wetcanvas.com/forums/archive/index.php/t-1326797.html)
- [Painting Without Outlines? (X-Post) - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/painting-without-outlines-x-post/)
- [Perspective How To - WetCanvas: Online Living for Artists](https://wetcanvas.com/forums/archive/index.php/t-552237.html)
- [Please help critique my portrait painting!! - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/please-help-critique-my-portrait-painting-2/)
- [Please Help: drawing on the canvas - WetCanvas: Online Living for Artists](https://wetcanvas.com/forums/archive/index.php/t-1316220.html)
- [project discussion paint with zorn s palette](https://www.wetcanvas.com/forums/topic/project-discussion-paint-with-zorn-s-palette)
- [What are the different methods of figure drawing? - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/what-are-the-different-methods-of-figure-drawing/)
- [www.wetcanvas.com](https://www.wetcanvas.com/forums/topic/any-tips-on-painting-alla-prima/page/2)
- [Your Perspective on a Muted vs Saturated Color Scheme? - WetCanvas: Online Living for Artists](https://www.wetcanvas.com/forums/topic/your-perspective-on-a-muted-vs-saturated-color-scheme/)

### nma.art (27)

- [- Lesson Details](https://www.nma.art/?p=1335432)
- [home › Forums › Art & Artwork › Open Critique › Planes of the Head Drawing 9 x12](https://www.nma.art/forums/topic/planes-of-the-head-drawing-9-x12/)
- [Jan's Replies](https://www.nma.art/forums/users/janstannard/replies/page/8/)
- [nma.art](https://nma.art/course-description/complete-sight-size-drawing-course/)
- [nma.art](https://nma.art/?p=1191274)
- [Planes of the Head Drawing 9 x12](https://nma.art/?p=631780)
- [Sight-Size Method Lesson 2: Beginner Bargue Plate Project](https://nma.art/forums/topic/sight-size-method-lesson-2-beginner-bargue-plate-project)
- [Topic: 100 Day Challenge: Heads and Faces-planes/structure/proportion](https://www.nma.art/forums/topic/100-day-challenge-heads-and-faces-planes-structure-proportion/)
- [Topic: Alex’s 100 day art challenge](https://www.nma.art/forums/topic/alexs-100-day-art-challenge/page/9/)
- [Topic: Charcoal and Sauce drawing](https://www.nma.art/forums/topic/charcoal-and-sauce-drawing-critique-appreciated/)
- [Topic: Intermediate Head Construction](https://www.nma.art/forums/topic/intermediate-head-construction/)
- [Topic: Models Bridgette and Serge from image library](https://www.nma.art/forums/topic/models-bridgette-and-serge-from-image-library/)
- [Topic: Portrait Drawings](https://www.nma.art/forums/topic/portrait-drawings/)
- [Topic: Proportions](https://www.nma.art/forums/topic/proportions/)
- [Topic: Ram’s 100 Day Challenge: Gesture and Structure](https://www.nma.art/forums/topic/rams-100-day-challenge-gesture-and-structure-figure-drawing/page/2/)
- [www.nma.art](https://www.nma.art/?p=2767215)
- [www.nma.art](https://www.nma.art/?p=1199008)
- [www.nma.art](https://www.nma.art/?p=2767218)
- [www.nma.art](https://www.nma.art/?p=1199011)
- [www.nma.art](https://www.nma.art/?p=2767216)
- [www.nma.art](https://www.nma.art/?p=2767214)
- [www.nma.art](https://www.nma.art/?p=1198921)
- [www.nma.art](https://www.nma.art/?p=334645)
- [www.nma.art](https://www.nma.art/?p=350913)
- [www.nma.art](https://www.nma.art/?p=334721)
- [www.nma.art](https://www.nma.art/?p=2305033)
- [www.nma.art](https://www.nma.art/?p=29274)

### line-of-action.com (26)

- ['Simple' Animal Figure Drawing Tips? - Line of Action](https://line-of-action.com/forums/topic/simple-animal-figure-drawing-tips?page=1)
- [10 Minute poses - Line of Action](https://line-of-action.com/index.php/forums/topic/10-minute-poses?page=1)
- [Additional practice](https://line-of-action.com/art/view/9096)
- [advice on figure - Line of Action](https://line-of-action.com/forums/topic/figure?page=1)
- [Anatomy Practice - Line of Action](https://line-of-action.com/forums/topic/anatomy-practice?page=1)
- [Construction of figure and a bit of gesture - Line of Action](https://www.line-of-action.com/zh/forums/topic/construction-of-figure-and-a-bit-of-gesture)
- [Figure Drawing 3/8/22 (First time posting!) - Line of Action](https://line-of-action.com/forums/topic/figure-drawing-3822-first-time-posting)
- [Figure drawing 30 minute Session - Line of Action](https://line-of-action.com/forums/topic/figure-drawing-30-minute-session?page=1)
- [FIgure Drawing practice - Line of Action](https://line-of-action.com/forums/topic/figure-drawing-practice)
- [Figure Drawing Session - Line of Action](https://line-of-action.com/en/forums/topic/figure-drawing-session)
- [First time gesture drawing - Line of Action](https://line-of-action.com/forums/topic/first-time-gesture-drawing)
- [Forum posts by Drunkenelf - Line of Action](https://line-of-action.com/index.php/forums/users/51087/replies)
- [Forum posts by Tx Williep - Line of Action](https://line-of-action.com/index.php/forums/users/57309/replies?page=3)
- [Forumberichten van Torrilin](https://www.line-of-action.com/nl/forums/users/53786/replies?page=4)
- [Gesture basics #2: Head, ribcage and pelvis](https://line-of-action.com/gesture-basics-2-torso-and-hips/)
- [gesture drawings - how to improve? - Line of Action](https://line-of-action.com/index.php/forums/topic/gesture-drawings-how-to-improve?page=1)
- [Gesture: I don't know what I'm doing - Line of Action](https://line-of-action.com/index.php/forums/topic/gesture-i-dont-know-what-im-doing)
- [Hello all! Would appreciate a critique & some advice on my gesture drawing! - Line of Action](https://line-of-action.com/forums/topic/hello-all-would-appreciate-a-critique-some-advice-on-my-gesture-drawing)
- [Learn how to draw - Using reference tools](https://line-of-action.com/learn-to-draw)
- [line-of-action.com](https://line-of-action.com/en/forums/users/190807/replies?page=3)
- [line-of-action.com](https://line-of-action.com/en/forums/users/190807/replies?page=20)
- [line-of-action.com](https://line-of-action.com/en/forums/users/190807/replies?page=13)
- [need some suggestions - Line of Action](https://www.line-of-action.com/zh-Hant/forums/topic/need-some-suggestions)
- [Quick Pose Practice](https://line-of-action.com/forums/topic/quick-pose-practice-using-the-bean)
- [What are the fundamentals of figure drawing in your opinion? - Line of Action](https://line-of-action.com/forums/topic/what-are-the-fundamentals-of-figure-drawing-in-your-opinion)
- [www.line-of-action.com](https://www.line-of-action.com/index.php/forums/users/190807/replies?page=20)

### polycount.com (11)

- [(Critique) Male head sculpt, looking for advice — polycount](https://polycount.com/discussion/233457/critique-male-head-sculpt-looking-for-advice)
- [(Anatomy) ~ I require help to understand human proportions (3D sculpting) — polycount](https://polycount.com/discussion/214955/anatomy-i-require-help-to-understand-human-proportions-3d-sculpting)
- [(Critique needed) Head sculpt: likeness and anatomy — polycount](https://polycount.com/discussion/233203/critique-needed-head-sculpt-likeness-and-anatomy)
- [(Seeking Feedback) Sculpting a Masculine Head/Face Study — polycount](https://polycount.com/discussion/230375/seeking-feedback-sculpting-a-masculine-head-face-study)
- [Anatomy/pose help (sculpting/rigging pose) — polycount](https://polycount.com/discussion/232453/anatomy-pose-help-sculpting-rigging-pose)
- [Here are some quick guidelines to check your facial proportions:](https://polycount.com/discussion/comment/1852559)
- [my first character sculpt... — polycount](https://polycount.com/discussion/118626/my-first-character-sculpt)
- [My first head sculpt! Feedback really appreciated! — polycount](https://polycount.com/discussion/234370/my-first-head-sculpt-feedback-really-appreciated)
- [Need help and pointers for my head anatomy study — polycount](https://polycount.com/discussion/234031/need-help-and-pointers-for-my-head-anatomy-study)
- [NEWBIE doing Daily Head Sculpts for 30 days. - Page 2 — polycount](https://polycount.com/discussion/213996/newbie-doing-daily-head-sculpts-for-30-days/p2)
- [NEWBIE! learning anatomy, uploading daily progress. — polycount](https://polycount.com/discussion/214672/newbie-learning-anatomy-uploading-daily-progress)

### crimsondaggers.com (9)

- [Anomily's Sketchbook](https://crimsondaggers.com/forum/post-131604.html)
- [BastionWing's Sketchbook](https://crimsondaggers.com/forum/thread-7757.html)
- [Crimson Daggers — Art forum](https://crimsondaggers.com/forum/printthread.php?tid=8607)
- [Crimson Daggers — Art forum](https://crimsondaggers.com/forum/printthread.php?tid=8819)
- [Leysan's Sketchbook](https://crimsondaggers.com/forum/post-126408.html)
- [Lost on heads](https://crimsondaggers.com/forum/thread-6964.html)
- [Lyraina's sketchbook](https://crimsondaggers.com/forum/thread-2412.html)
- [Peter's Sketchbook](https://crimsondaggers.com/forum/thread-8171-post-120152.html)
- [thread 8607](https://crimsondaggers.com/forum/thread-8607.html)

### artistsnetwork.com (7)

- [5 Painting Tips to Succeed at Alla Prima](https://artistsnetwork.com/art-mediums/painting-alla-prima)
- [Drawing Shadows and Light: The Basics](https://www.artistsnetwork.com/art-techniques/beginner-artist/beginner-drawing-shadows-and-light-the-basics)
- [Oil Painting Demo: Painting Dark to Light](https://www.artistsnetwork.com/art-mediums/oil-painting/oil-painting-dark-to-light-a-demo/amp/)
- [Photo by Marco Bianchetti on Unsplash](https://www.artistsnetwork.com/art-techniques/beginner-artist/beginner-drawing-shadows-and-light-the-basics/amp)
- [The Bargue Method at the Academy of Realist Art](https://artistsnetwork.com/art-mediums/drawing/the-bargue-method-at-the-academy-of-realist-art)
- [The VALUE of Notan](https://www.artistsnetwork.com/art-mediums/pastel/the-value-of-notan/amp)
- [www.artistsnetwork.com](https://www.artistsnetwork.com/art-mediums/painting-alla-prima/amp)

### forums.cubebrush.co (6)

- [Difficulty drawing heads - Art Critique - Forums - Cubebrush](https://forums.cubebrush.co/t/difficulty-drawing-heads/1512)
- [forums.cubebrush.co](https://forums.cubebrush.co/t/perspective-and-face-proportions/11979)
- [forums.cubebrush.co](https://forums.cubebrush.co/t/basic-head-drawings-critique/10788)
- [Hi, that's a nice amount of work, I like your figures :smile:](https://forums.cubebrush.co/t/lockenheim-art-school-journey/10748/19)
- [Please critique the anatomy of my character draft - Art Critique - Forums - Cubebrush](https://forums.cubebrush.co/t/please-critique-the-anatomy-of-my-character-draft/11201)
- [Term 1 & 2 Anatomy - Zane - Art School - Forums - Cubebrush](https://forums.cubebrush.co/t/term-1-2-anatomy-zane/7298)

### shapes.inc (4)

- [Back to loomis face](https://shapes.inc/loomisface/faq)
- [Back to loomis head](https://shapes.inc/loomishead/fun-facts)
- [Back to loomis technique](https://shapes.inc/loomistechnique/faq)
- [loomis drawing method avatar](https://shapes.inc/loomisdrawingme)

### drawpaintacademy.com (4)

- [alla prima painting tips](https://drawpaintacademy.com/alla-prima-painting-tips/)
- [drawpaintacademy.com](https://drawpaintacademy.com/?p=8332)
- [drawpaintacademy.com](https://drawpaintacademy.com/zorn-palette/)
- [This is a detailed guide on the idea of notan and how you can use it to improve your art. I’ll cover:](https://drawpaintacademy.com/notan/)

### cf-inc.shapes.inc (2)

- [loomis face avatar](https://cf-inc.shapes.inc/loomisface)
- [loomis head avatar](https://cf-inc.shapes.inc/loomishead)

### skillshare.com (2)

- [How to Easily Draw Heads | Understanding the Loomis Method | Messer Creations | Skillshare](https://www.skillshare.com/en/classes/How-to-Easily-Draw-Heads-Understanding-the-Loomis-Method/1444065786)
- [Master the Loomis Method and draw accurate portraits from any angle. | Tristan | Skillshare](https://www.skillshare.com/en/classes/master-the-loomis-method-and-draw-accurate-portraits-from-any-angle/75175592)

### apkcombo.com (1)

- [Learn Drawing AI & Tracing](https://apkcombo.com/sketch-steps-ai-loomis-draw/com.sketchsteps.app/)

### capcut.com (1)

- [Template 3D Loomis Head Gratis Dari CapCut](https://www.capcut.com/id-id/explore/3d-loomis-head/7513411869836986384)

### medium.com (1)

- [How to Draw Heads with the Andrew Loomis Method](https://medium.com/@ramstudioscomics/how-to-draw-heads-with-the-andrew-loomis-method-78f9d04ab132)

### finearttutorials.com (1)

- [Loomis Method](https://finearttutorials.com/guide/loomis-method/)

### artincontext.org (1)

- [Loomis Method – Master Portrait Drawing with Proven Techniques](https://artincontext.org/loomis-method)

### richardromeroartist.blogspot.com (1)

- [Saturday, August 3, 2024](https://richardromeroartist.blogspot.com/2024/08/how-to-construct-head-loomis-method.html)

### stoneye.artstation.com (1)

- [Planes and Rhythms of the Head](https://stoneye.artstation.com/store/kl1g/planes-and-rhythms-of-the-head)

### ia601603.us.archive.org (1)

- [Bridgman%20 %20Complete%20Guide%20to%20Drawing%20from%20Life text](https://ia601603.us.archive.org/20/items/pdfy-72f-FzW7wYN_r0ny/Bridgman%20-%20Complete%20Guide%20to%20Drawing%20from%20Life_text.pdf)

### ia600707.us.archive.org (1)

- [Bridgman%27s%20Complete%20Guide%20To%20Drawing%20From%20Life text](https://ia600707.us.archive.org/24/items/BridgmansCompleteGuideToDrawingFromLife_201812/Bridgman%27s%20Complete%20Guide%20To%20Drawing%20From%20Life_text.pdf)

### inkl.com (1)

- [how to create a polished character design from initial sketch to final render](https://www.inkl.com/news/how-to-create-a-polished-character-design-from-initial-sketch-to-final-render)

### zbrushcentral.com (1)

- [www.zbrushcentral.com](https://www.zbrushcentral.com/t/realistic-head-proportions-guide/220757)

## Foros, repositorios y documentación de programación

### github.com (70)

- [(Image from https://github.com/PeikeLi/Self-Correction-Human-Parsing/blob/master/demo/demo.jpg)](https://github.com/vitaliyhan/ailia-models/blob/master/image_segmentation/human_part_segmentation)
- [(Image from https://github.com/PeikeLi/Self-Correction-Human-Parsing/blob/master/demo/demo.jpg)](https://github.com/pannaqlucky/ailia-models/blob/master/image_segmentation/human_part_segmentation)
- [(Image from https://github.com/PeikeLi/Self-Correction-Human-Parsing/blob/master/demo/demo.jpg)](https://github.com/vitaliyhan/ailia-models/blob/master/image_segmentation/human_part_segmentation/README.md)
- [@hoangtnm Only the metric model's (model finetuned on kitti dataset) output is metric, meaning in meters. The other models output relative disparity (inverse depth) upto an unknown scale and unknown shift which needs to be computed using GT for example · Issue #233 · LiheYoung/Depth-Anything · GitHub](https://github.com/LiheYoung/Depth-Anything/issues/233)
- [(Feature Request): Animal Pose Preprocessor (RTMPose AP-10K) · Issue #2258 · Mikubill/sd-webui-controlnet · GitHub](https://github.com/Mikubill/sd-webui-controlnet/issues/2258)
- [(js/web) WebGPU backend · Issue #11695 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/11695)
- [(Request) Can DWPose Estimator add an option to not use the detection model? · Issue #537 · Fannovel16/comfyui_controlnet_aux · GitHub](https://github.com/Fannovel16/comfyui_controlnet_aux/issues/537)
- [(Web) `ort.min.js` loads the JSEP wasm for `executionProviders: ('wasm')`, and WebKit then uses 5-7 GB (still in 1.30.0, follow-up to #26827) · Issue #33516 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/33516)
- [(Web) Memory spike in ORT-web leading to app crash · Issue #15086 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/15086)
- [(Web) Severe CPU and memory issues in Safari/WebKit 26 with JSEP mode · Issue #26827 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/26827)
- [(Web) Web ~40x slower than native · Issue #16412 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/16412)
- [(Web) WebAssembly memory is not detachable for Web Worker · Issue #19157 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/19157)
- [(Web) WebAssembly: MatMulNBits dequantizes its whole weight matrix to float32 on every call (1 GB scratch for an LLM output layer; WebAssembly memory never shrinks; slow decode) · Issue #33795 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/33795)
- [(Web) WebGPU: constant folding a shared weight grows WebAssembly memory by up to 800 MB for good and puts a second copy on the GPU (iOS Safari tabs run out of memory) · Issue #33793 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/33793)
- [Add DWPose/RTMPose MLX whole-body face-landmark backend · Issue #909 · dahai80/fusion-mlx · GitHub](https://github.com/dahai80/fusion-mlx/issues/909)
- [computer-vision-course/chapters/en/unit8/monocular_depth_estimation.mdx at main · huggingface/computer-vision-course · GitHub](https://github.com/huggingface/computer-vision-course/blob/main/chapters/en/unit8/monocular_depth_estimation.mdx)
- [convert_dwpose/convert_face_parsing key mismatch + mel_filters asset not packaged · Issue #915 · dahai80/fusion-mlx · GitHub](https://github.com/dahai80/fusion-mlx/issues/915)
- [developer.chrome.com/site/en/blog/transferable-objects-lightning-fast/index.md at main · GoogleChrome/developer.chrome.com · GitHub](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/blog/transferable-objects-lightning-fast/index.md)
- [DWPose output is corrupted despite strict weight load — landmarks scattered/border-pinned · Issue #917 · dahai80/fusion-mlx · GitHub](https://github.com/dahai80/fusion-mlx/issues/917)
- [feat(vision): whole-body pose on the working image — keypoints, part boxes with size in frame, posture and head-angle tags; no crops · Issue #336 · borco/rehuco · GitHub](https://github.com/borco/rehuco/issues/336)
- [fix(control): DWPose, RTMW-l and RTMO-l load the wrong models by kirtasshh · Pull Request #5107 · vladmandic/sdnext · GitHub](https://github.com/vladmandic/sdnext/pull/5107)
- [fix: WASM-only ONNX Runtime bundle for the browser demo (WebKit memory) by El1as42 · Pull Request #31 · birdnet-team/BirdBox · GitHub](https://github.com/birdnet-team/BirdBox/pull/31)
- [GitHub - 0AnshuAditya0/monocular: Depth estimation with semantic object detection · GitHub](https://github.com/0AnshuAditya0/monocular)
- [GitHub - alombd/face-pose-mediapipe · GitHub](https://github.com/alombd/face-pose-mediapipe)
- [GitHub - Casit-ARIS-WQL/LAGRNet: Monocular Depth Estimation via Neural Network with Learnable Algebraic Group and Ring Structures · GitHub](https://github.com/Casit-ARIS-WQL/LAGRNet)
- [GitHub - chetnagurjar/human_pose_estimation: A Computer Vision project that performs real-time human pose estimation on dance and movement videos using YOLO Pose (COCO 17 keypoints) and OpenCV, generating skeleton-only visualizations on a black background. · GitHub](https://github.com/chetnagurjar/human_pose_estimation)
- [GitHub - compphoto/BoostingMonocularDepth · GitHub](https://github.com/compphoto/BoostingMonocularDepth)
- [GitHub - continue-revolution/sd-webui-segment-anything: Segment Anything for Stable Diffusion WebUI · GitHub](https://github.com/continue-revolution/sd-webui-segment-anything)
- [GitHub - cornpip/mediapipe_face_mesh: Real-time MediaPipe face mesh for Flutter: 478 landmarks with iris, multi-face tracking, ARKit-style blendshapes, and 3D head pose. · GitHub](https://github.com/cornpip/mediapipe_face_mesh)
- [GitHub - deepghs/imgutils: A convenient and user-friendly anime-style image data processing library that integrates various advanced anime-style image processing models · GitHub](https://github.com/deepghs/imgutils)
- [GitHub - En-Mah/Web-Supervised-Monocular-Depth-Estimation: This project implements a ResNet-based model for monocular relative depth estimation using a ranking loss. It reproduces and evaluates the method proposed in “Monocular Relative Depth Perception with Web Stereo Data Supervision.” · GitHub](https://github.com/En-Mah/Web-Supervised-Monocular-Depth-Estimation)
- [GitHub - facebookresearch/sam-3d-body: The repository provides code for running inference with the SAM 3D Body Model (3DB), links for downloading the trained model checkpoints and datasets, and example notebooks that show how to use the model. · GitHub](https://github.com/facebookresearch/sam-3d-body)
- [GitHub - fashn-AI/fashn-human-parser: Human parsing model for fashion and virtual try-on applications · GitHub](https://github.com/fashn-AI/fashn-human-parser)
- [GitHub - gkjohnson/threading-js: Wrapper for Web Workers for easily running a function from the client without serving the worker a script · GitHub](https://github.com/gkjohnson/threading-js)
- [GitHub - GOH23/rtmlib-ts: Browser-only AI library for real-time object detection (YOLOv8n / YOLOv12n / YOLOv26n, MediaPipe EfficientDet-Lite0) and 3D pose estimation (RTMW3D-X COCO-WholeBody 133-keypoint 3D, InstantHMR MHR70 mesh) on ONNX Runtime Web — wasm, WebGL, WebGPU, WebNN. · GitHub](https://github.com/GOH23/rtmlib-ts)
- [GitHub - huggingface/optimum-onnx: 🤗 Optimum ONNX: Export your model to ONNX and run inference with ONNX Runtime · GitHub](https://github.com/huggingface/optimum-onnx)
- [GitHub - Isi-dev/ComfyUI-UniAnimate-W: This is a ComfyUI-Windows implementation of the image animation projects -> UniAnimate and Animate-X. · GitHub](https://github.com/Isi-dev/ComfyUI-UniAnimate-W)
- [GitHub - kapi0okapi/monocular-depth: Eleven depth models from one camera on KITTI's Eigen split, published numbers reproduced, and a real-time model fine-tuned to measure in metres. · GitHub](https://github.com/kapi0okapi/monocular-depth)
- [GitHub - mkldhz/Head-Pose-Estimation: This project aims to estimate head pose via face 2D landmarks using machine learning.](https://github.com/mkldhz/Head-Pose-Estimation)
- [GitHub - moizahmedk/pose-posture-classifier: Standing/sitting/lying classification from 2D human pose — MMDetection + MMPose with explainable, unit-tested geometric rules. · GitHub](https://github.com/moizahmedk/pose-posture-classifier)
- [GitHub - morsechim/HeadPoseDirection · GitHub](https://github.com/morsechim/HeadPoseDirection)
- [GitHub - Mostafa-Nafie/Head-Pose-Estimation: This project utilizes machine learning algorithms to find the direction in which a person is looking by using the face landmarks · GitHub](https://github.com/Mostafa-Nafie/Head-Pose-Estimation)
- [GitHub - open-mmlab/mmpose: OpenMMLab Pose Estimation Toolbox and Benchmark. · GitHub](https://github.com/open-mmlab/mmpose)
- [GitHub - romack77/vp-toolbox: Vanishing point detection toolbox. · GitHub](https://github.com/romack77/vp-toolbox)
- [GitHub - simbaforrest/vpdetection: Automatically exported from code.google.com/p/vpdetection · GitHub](https://github.com/simbaforrest/vpdetection)
- [GitHub - tcpfin-dev/DepthDetection: Zero-Shot Monocular Depth Estimation for Automated Crop/Object Sizing in Low-Contrast Environments · GitHub](https://github.com/tcpfin-dev/DepthDetection)
- [GitHub - The-shriram14/FaceView: Real-time head orientation detection using Python, OpenCV, MediaPipe, and head-pose estimation. · GitHub](https://github.com/The-shriram14/FaceView)
- [github.com](https://github.com/cvg/GeoCalib)
- [github.com](https://github.com/Tau-J/rtmlib)
- [github.com](https://github.com/gellston/mlsd)
- [head-pose-estimation · GitHub Topics · GitHub](https://github.com/topics/head-pose-estimation?o=asc&s=stars)
- [mmpose/projects/rtmpose at main · open-mmlab/mmpose · GitHub](https://github.com/open-mmlab/mmpose/tree/main/projects/rtmpose)
- [Negative point prompts are being ignored · Issue #695 · facebookresearch/sam2 · GitHub](https://github.com/facebookresearch/sam2/issues/695)
- [Official Tensorflow implementation of "M-LSD: Towards Light-weight and Real-time Line Segment Detection"](https://github.com/Kazuhito00/mlsd)
- [onnxruntime-web is 11-17x times slower than native inference · Issue #11181 · microsoft/onnxruntime · GitHub](https://github.com/microsoft/onnxruntime/issues/11181)
- [open km](https://www.github.com/lwander/open-km)
- [perf(store): transfer worker reads as typed arrays instead of cloning by dirkwa · Pull Request #265 · SignalK/tracks · GitHub](https://github.com/SignalK/tracks/pull/265)
- [Performance optimization opportunities for structured cloning · Issue #21 · ungap/structured-clone · GitHub](https://github.com/ungap/structured-clone/issues/21)
- [Releases · open-mmlab/mmpose · GitHub](https://github.com/open-mmlab/mmpose/releases)
- [RuntimeError: Unsupported Input Type When Exporting Model to ONNX · Issue #8 · cvg/GeoCalib · GitHub](https://github.com/cvg/GeoCalib/issues/8)
- [sketch simplification](https://www.github.com/bobbens/sketch_simplification)
- [structuredClone: index the clone memory instead of scanning it by andreasrosdal · Pull Request #169 · nordstjernen-web/northstar-web-browser · GitHub](https://github.com/nordstjernen-web/northstar-web-browser/pull/169)
- [There is a mistake when download model "segformer_b3_clothes", caused by mistaken "-" in config.py · Issue #831 · yolain/ComfyUI-Easy-Use · GitHub](https://github.com/yolain/ComfyUI-Easy-Use/issues/831)
- [Transfer huge binary data buffer between service worker and content script (more efficiently) · Issue #293 · w3c/webextensions · GitHub](https://github.com/w3c/webextensions/issues/293)
- [Transferable objects · Issue #23 · padolsey/operative · GitHub](https://github.com/padolsey/operative/issues/23)
- [Using a mask prompt for boundary refinement · Issue #169 · facebookresearch/segment-anything · GitHub](https://github.com/facebookresearch/segment-anything/issues/169)
- [visual-slam-roadmap/level-05-deep-learning/monodepth.md at main · changh95/visual-slam-roadmap · GitHub](https://github.com/changh95/visual-slam-roadmap/blob/main/level-05-deep-learning/monodepth.md)
- [When detect_face is set to false in the DWPose preprocessor, the POSE_KEYPOINT output still contains face keypoints. · Issue #606 · Fannovel16/comfyui_controlnet_aux · GitHub](https://github.com/Fannovel16/comfyui_controlnet_aux/issues/606)
- [Worker host: typed request/response protocol, transferables, cancellation, progress · Issue #44 · kevinmcaleer/BetterCad · GitHub](https://github.com/kevinmcaleer/BetterCad/issues/44)
- [www.github.com](https://www.github.com/stuffmatic/fSpy/issues/119)

### huggingface.co (67)

- [All credit to this repo: https://huggingface.co/spaces/carolineec/informativedrawings](https://huggingface.co/rocca/informative-drawings-line-art-onnx/blob/main/README.md)
- [BritishWerewolf/IS-Net-Anime · Hugging Face](https://huggingface.co/BritishWerewolf/IS-Net-Anime)
- [ComfyUI/models/segformer_b2_clothes/README.md · chflame163/ComfyUI_LayerStyle at main](https://huggingface.co/chflame163/ComfyUI_LayerStyle/blob/main/ComfyUI/models/segformer_b2_clothes/README.md)
- [deepghs/anime_face_detection · Hugging Face](https://huggingface.co/deepghs/anime_face_detection)
- [deepghs/real_head_detection · Hugging Face](https://huggingface.co/deepghs/real_head_detection)
- [deepghs/real_person_detection · Hugging Face](https://huggingface.co/deepghs/real_person_detection)
- [Edit model card](https://huggingface.co/Metal3d/deeplabv3p-resnet50-human)
- [Export a model to ONNX with optimum.exporters.onnx](https://huggingface.co/docs/optimum/en/exporters/onnx/usage_guides/export_a_model)
- [Export a model to ONNX with optimum.exporters.onnx · Hugging Face](https://huggingface.co/docs/optimum-onnx/onnx/usage_guides/export_a_model)
- [Export functions](https://huggingface.co/docs/optimum/main/en/exporters/onnx/package_reference/export)
- [Export to ONNX · Hugging Face](https://huggingface.co/docs/transformers/v4.29.1/serialization)
- [Exporters · Hugging Face](https://huggingface.co/docs/transformers/en/exporters)
- [Exporting transformers models — transformers 4.7.0 documentation](https://huggingface.co/transformers/v4.9.2/serialization.html)
- [Exporting 🤗 Transformers Models · Hugging Face](https://huggingface.co/docs/transformers/v4.17.0/serialization)
- [face parsing](https://huggingface.co/jonathandinu/face-parsing)
- [Face Parsing](https://huggingface.co/jayson1408/faceparsing)
- [face-parsing / README.md](https://huggingface.co/jonathandinu/face-parsing/blob/b6e0b89f07f8f4f941b743e69c9456332a13bdbf/README.md)
- [fashn-ai/fashn-human-parser · Hugging Face](https://huggingface.co/fashn-ai/fashn-human-parser)
- [File size: 168 Bytes](https://huggingface.co/rocca/informative-drawings-line-art-onnx/blame/main/README.md)
- [File size: 899 Bytes](https://huggingface.co/spaces/gartajackhats1985/custom_nodes/blame/main/comfyui_controlnet_aux/node_wrappers/lineart_anime.py)
- [GeoCalib field net, ONNX export](https://huggingface.co/mprib/geocalib-fields-onnx)
- [Hugging Face](https://huggingface.co/jellybox/isnet-anime)
- [Hugging Face](https://huggingface.co/rocca/informative-drawings-line-art-onnx/commits/main)
- [Hugging Face](https://huggingface.co/rocca/informative-drawings-line-art-onnx/tree/bd8dc220e5ccaa3820aaced4cac9470ff8553516)
- [Hugging Face](https://huggingface.co/rocca/informative-drawings-line-art-onnx/tree/d38eccbd448cdcd228fb81d708506e5e60b41ccb)
- [Hugging Face](https://huggingface.co/rocca/informative-drawings-line-art-onnx/commit/d38eccbd448cdcd228fb81d708506e5e60b41ccb)
- [Hugging Face](https://huggingface.co/rocca/informative-drawings-line-art-onnx/tree/main)
- [Hugging Face](https://huggingface.co/Xenova/face-parsing/commits/main/onnx)
- [Hugging Face](https://huggingface.co/Xenova/face-parsing/commits/main)
- [Hugging Face](https://huggingface.co/Xenova/face-parsing/tree/fd2e1503700c97662593d143e874b29f6676ca24/onnx)
- [Hugging Face](https://huggingface.co/Xenova/face-parsing/commits/main/onnx/model_fp16.onnx)
- [Hugging Face](https://huggingface.co/Xenova/face-parsing/tree/18eb28f69a189807069b4a2926ba0314c024be72)
- [Hugging Face](https://huggingface.co/Xenova/face-parsing/tree/99bb348bb2a90c9174aa73306bf82b91536c48c1)
- [Hugging Face](https://huggingface.co/jonathandinu/face-parsing/commits/main/onnx)
- [Hugging Face](https://huggingface.co/Xenova/segformer_b2_clothes/tree/b8b2954822bb860d731403ef2c0ccfdda45ec7b1/onnx)
- [Hugging Face](https://huggingface.co/Xenova/segformer_b2_clothes/tree/main/onnx)
- [Hugging Face](https://huggingface.co/Xenova/segformer_b2_clothes/commits/main/onnx)
- [Hugging Face](https://huggingface.co/Xenova/segformer_b2_clothes/tree/b5ddd0fb2a957b9ed40074655c4cd82ff63ad137)
- [Hugging Face](https://huggingface.co/Xenova/segformer_b2_clothes/commits/main/config.json)
- [Hugging Face](https://huggingface.co/Xenova/segformer_b2_clothes/tree/main)
- [Hugging Face's logo Hugging Face](https://huggingface.co/Xenova/face-parsing/tree/main/onnx)
- [huggingface.co](https://huggingface.co/papers/2202.05822)
- [huggingface.co](https://huggingface.co/spaces/akhaliq/mlsd/blob/9c212e552490f62e38f89f836854d9b813029e35/app.py)
- [huggingface.co](https://huggingface.co/jonathandinu/face-parsing/blob/main/README.md?code=true)
- [huggingface.co](https://huggingface.co/papers/2108.01819)
- [huggingface.co](https://huggingface.co/WeReCooking/sapiens2-onnx/commit/2d6b460e42ddb77c9694ca7787e9ca35e00cb9ce)
- [huggingface.co](https://huggingface.co/WeReCooking/sapiens2-onnx/blob/main/README.md)
- [inference4j/depth-anything-v2-small · Hugging Face](https://huggingface.co/inference4j/depth-anything-v2-small)
- [isnet-anime.onnx · jellybox/isnet-anime at e148f469671b6435c2ad8bb64dfa69507511ebb3](https://huggingface.co/jellybox/isnet-anime/blob/e148f469671b6435c2ad8bb64dfa69507511ebb3/isnet-anime.onnx)
- [isnet-anime_1024.onnx · jellybox/isnet-anime at main](https://huggingface.co/jellybox/isnet-anime/blob/main/isnet-anime_1024.onnx)
- [jellybox/isnet-anime at 008308a78eb1668651a499e0138efa4f3dc7fe1c](https://huggingface.co/jellybox/isnet-anime/tree/008308a78eb1668651a499e0138efa4f3dc7fe1c)
- [jellybox/isnet-anime at main](https://huggingface.co/jellybox/isnet-anime/tree/main)
- [language: en](https://huggingface.co/jayson1408/faceparsing/raw/main/README.md)
- [lineart anime](https://huggingface.co/spaces/gartajackhats1985/custom_nodes/raw/028694a8f306735577e8dffd4336202c4b7eaf8f/comfyui_controlnet_aux/node_wrappers/lineart_anime.py)
- [lineart anime](https://huggingface.co/spaces/Dreamspire/flux-style-shaping/blob/refs%2Fpr%2F1/custom_nodes/comfyui_controlnet_aux/node_wrappers/lineart_anime.py)
- [matei-dorian/segformer-b0-finetuned-human-parsing · Hugging Face](https://huggingface.co/matei-dorian/segformer-b0-finetuned-human-parsing)
- [mattmdjaga/segformer_b0_clothes · Hugging Face](https://huggingface.co/mattmdjaga/segformer_b0_clothes)
- [mattmdjaga/segformer_b2_clothes · Hugging Face](https://huggingface.co/mattmdjaga/segformer_b2_clothes)
- [ONNX Runtime · Hugging Face](https://huggingface.co/docs/diffusers/en/optimization/onnx)
- [Petrouil/Depth-Anything-V2-Tiny-hf · Hugging Face](https://huggingface.co/Petrouil/Depth-Anything-V2-Tiny-hf)
- [schp-pascal-7 / README.md](https://huggingface.co/pirocheto/schp-pascal-7/blob/main/README.md)
- [segformer b2 clothes](https://huggingface.co/Xenova/segformer_b2_clothes)
- [SMPLify body fit](https://huggingface.co/cy0307/a-smplify-fit)
- [Stax124/anime-face-detection-safetensors · Hugging Face](https://huggingface.co/Stax124/anime-face-detection-safetensors)
- [yolo12138/segformer-b2-human-parse-24 · Hugging Face](https://huggingface.co/yolo12138/segformer-b2-human-parse-24)
- [yolov8m-face/model.onnx · deepghs/yolo-face at main](https://huggingface.co/deepghs/yolo-face/blob/main/yolov8m-face/model.onnx)
- [yolov8n-face/model.onnx · deepghs/yolo-face at 1eb85df806aed8a6789c88dcf7194005aaed6fe2](https://huggingface.co/deepghs/yolo-face/blob/1eb85df806aed8a6789c88dcf7194005aaed6fe2/yolov8n-face/model.onnx)

### docs.toonboom.com (4)

- [Adjusting a 5-Points Perspective (Fisheye) Drawing Guide](https://docs.toonboom.com/help/storyboard-pro-7/drawing/edit-5-points-perspective-fisheye-guide.html)
- [Adjusting a 5-Points Perspective (Fisheye) Drawing Guide](https://docs.toonboom.com/help/storyboard-pro-25/drawing/edit-5-points-perspective-fisheye-guide.html)
- [Art Layers](https://docs.toonboom.com/help/harmony-12/advanced-server/Content/_CORE/_Workflow/013_Ink_n_Paint/006A_H1_Art_Layers.html)
- [Art Layers](https://docs.toonboom.com/help/harmony-12-2/paint/ink-paint/art-layers.html)

### awesome.ecosyste.ms (3)

- [awesome.ecosyste.ms](https://awesome.ecosyste.ms/projects/github.com%2Fzhou13%2Fneurvps)
- [github.com%2Fbobbens%2Fsketch simplification](https://awesome.ecosyste.ms/projects/github.com%2Fbobbens%2Fsketch_simplification)
- [https://github.com/SkyTNT/anime-segmentation](https://awesome.ecosyste.ms/projects/github.com/SkyTNT/anime-segmentation)

### astro.paperswithcode.com (3)

- [bizarre pose dataset](https://astro.paperswithcode.com/dataset/bizarre-pose-dataset)
- [CubifAE-3D: Monocular Camera Space Cubification for Auto-Encoder based 3D Object Detection](https://astro.paperswithcode.com/paper/cubifae-3d-monocular-camera-space)
- [Hybrid coarse-fine classification for head pose estimation](https://astro.paperswithcode.com/paper/hybrid-coarse-fine-classification-for-head)

### docs.unity3d.com (3)

- [Posterize Node](https://docs.unity3d.com/Packages/com.unity.shadergraph@7.6/manual/Posterize-Node.html)
- [Posterize Node](https://docs.unity3d.com/Packages/com.unity.shadergraph@5.6/manual/Posterize-Node.html)
- [Posterize Node](https://docs.unity3d.com/Packages/com.unity.shadergraph@5.3/manual/Posterize-Node.html)

### medium.com (2)

- [HumanPartSegmentation : A Machine Learning Model for Segmenting Human Parts](https://medium.com/axinc-ai/humanpartsegmentation-a-machine-learning-model-for-segmenting-human-parts-cd7e39480714)
- [Notes on Drawing Methods](https://medium.com/the-art-spirit/advanced-open-studio-with-sadie-part-2-b-5ffe7f02aae4)

### universe.roboflow.com (2)

- [Anime-Character-Segmentation Computer Vision Dataset](https://universe.roboflow.com/just-stuff/anime-character-segmentation-ba9jh)
- [SegmentaionALL Computer Vision Project](https://universe.roboflow.com/anime-imprimatura/segmentaionall)

### dongle94.github.io (1)

- [(Paper) RTMW: Real-Time Multi-Person 2D and 3D Whole-body Pose Estimation (arXiv’24) - Dongle’s 개발노트](https://dongle94.github.io/paper/RTMW/)

### docs.ultralytics.com (1)

- [Pose Estimation with Ultralytics YOLO](https://docs.ultralytics.com/tasks/pose)

### facebookresearch.github.io (1)

- [MHR: Momentum Human Rig](https://facebookresearch.github.io/MHR)

### mmpose.readthedocs.io (1)

- [Overview — MMPose 1.3.2 documentation](https://mmpose.readthedocs.io/en/latest/model_zoo.html)

### forasoft.com (1)

- [RTMPose vs MediaPipe vs OpenPose vs ViTPose: 2026 Guide](https://www.forasoft.com/learn/ai-for-video-engineering/articles-ai/openpose-mediapipe-rtmpose-pose-tracking)

### gitlab.hesconet.com (1)

- [gitlab.hesconet.com](https://gitlab.hesconet.com/BR/issuu/==QVXJ1RaZEcrJmRaVXYGhmVldFO3lVMnhnVwUDeStGZTJVMwdkVrh2bNJjSUJVbwhFZyQ3VUdVO3ZFbwh1YHR3VWdFayZVMSFWTXVkejRkTVZFbKhkVn1TP)

### cs.paperswithcode.com (1)

- [2 code implementations • 1 Jun 2021 • Geonmo Gu, Byungsoo Ko, SeoungHyun Go, Sung-Hyun Lee, Jingeun Lee, Minchul Shin](https://cs.paperswithcode.com/author/seounghyun-go)

### paperswithcode.co (1)

- [Paper · arXiv:1901.06778 · 21 January 2019](https://paperswithcode.co/paper/1901.06778)

### paperswithcode.com (1)

- [Transfer Learning for Pose Estimation of Illustrated Characters](https://www.paperswithcode.com/paper/transfer-learning-for-pose-estimation-of)

### facelessuser.github.io (1)

- [facelessuser.github.io](https://facelessuser.github.io/coloraide-extras/interpolate/spectral)

### redirect.github.com (1)

- [redirect.github.com](https://redirect.github.com/lettier/3d-game-shaders-for-beginners/blob/master/sections/posterization.md)

### pykinematics.readthedocs.io (1)

- [calibration.compute hip center](https://pykinematics.readthedocs.io/en/latest/ref/omc/calibration.compute_hip_center.html)

### gist.github.com (1)

- [Typed Array Transferable pingpong · GitHub](https://gist.github.com/kig/2158904)

### news.ycombinator.com (1)

- [In case it wasn't clear, when I said prefer typed arrays over objects, I literal...](https://news.ycombinator.com/item?id=15066302)

## Artículos científicos

### arxiv.org (145)

- [1 AttentionPainter: An Efficient and Adaptive](https://arxiv.org/pdf/2410.16418)
- [1 Fisheye Distortion Rectiﬁcation from Deep Straight Lines](https://arxiv.org/pdf/2003.11386)
- [1 Recovering 3D Human Mesh from Monocular Images: A Survey](https://arxiv.org/pdf/2203.01923)
- [(2108.12617) AP-10K: A Benchmark for Animal Pose Estimation in the Wild](https://arxiv.org/abs/2108.12617)
- [(2203.12691) Learning to generate line drawings that convey geometry and semantics](https://arxiv.org/abs/2203.12691)
- [(2206.02998) Joint Geometric-Semantic Driven Character Line Drawing Generation](https://arxiv.org/abs/2206.02998)
- [(2407.08634) RTMW: Real-Time Multi-Person 2D and 3D Whole-body Pose Estimation](https://arxiv.org/abs/2407.08634)
- [A Deep Perceptual Measure for Lens and Camera Calibration](https://arxiv.org/pdf/2208.12300)
- [A Method for Animating Children's Drawings of the Human Figure](https://arxiv.org/pdf/2303.12741)
- [A Perceptual Measure for Deep Single Image Camera Calibration](https://arxiv.org/pdf/1712.01259)
- [A Survey on Hough Transform, Theory, Techniques and Applications](https://arxiv.org/pdf/1502.02160)
- [A Vector-based Representation to Enhance Head Pose Estimation](https://arxiv.org/pdf/2010.07184)
- [ACE-Data-0: Human-Centric Ambient Capture as Embodied Data Engine](https://arxiv.org/pdf/2607.28625)
- [AcED: Accurate and Edge-consistent Monocular Depth Estimation](https://arxiv.org/pdf/2006.09243)
- [Aligned Anchor Groups Guided Line Segment Detector](https://arxiv.org/pdf/2509.00786)
- [Analytical Modeling of Vanishing Points and Curves in Catadioptric Cameras](https://arxiv.org/pdf/1804.09460)
- [Any to Full: Prompting Depth Anything for Depth Completion in One Stage](https://arxiv.org/pdf/2603.05711)
- [Artist Agent: A Reinforcement Learning Approach](https://arxiv.org/pdf/1206.4634)
- [arxiv.org](https://arxiv.org/html/2409.06704v2)
- [arxiv.org](https://arxiv.org/pdf/2504.13297v1.pdf)
- [arxiv.org](https://arxiv.org/pdf/2504.13297)
- [arxiv.org](https://arxiv.org/pdf/2603.19538)
- [arxiv.org](https://arxiv.org/pdf/2411.16833v1)
- [arxiv.org](https://arxiv.org/pdf/1703.08966v1.pdf)
- [arxiv.org](https://arxiv.org/abs/2202.05822)
- [arxiv.org](https://arxiv.org/pdf/2409.06704)
- [arxiv.org](https://arxiv.org/pdf/2602.03749)
- [arxiv.org](https://arxiv.org/abs/2412.20666)
- [arxiv.org](https://arxiv.org/pdf/2309.07654v1.pdf)
- [arxiv.org](https://arxiv.org/pdf/2311.06038v1.pdf)
- [arxiv.org](https://arxiv.org/pdf/1909.01040v1.pdf)
- [arxiv.org](https://arxiv.org/pdf/1904.10506v1)
- [arxiv.org](https://arxiv.org/pdf/2601.02267v1)
- [arxiv.org](https://arxiv.org/abs/2108.01819)
- [arxiv.org](https://arxiv.org/pdf/2303.02760v2.pdf)
- [arxiv.org](https://arxiv.org/pdf/2408.12569)
- [arxiv.org](https://arxiv.org/pdf/2205.00076v1.pdf)
- [AttentionPainter: An Efficient and Adaptive Stroke Predictor for Scene Painting](https://arxiv.org/html/2410.16418.pdf)
- [Benchmarking 3D Human Pose Estimation Models under Occlusions](https://arxiv.org/pdf/2504.10350)
- [Bottom-Up 2D Pose Estimation via Dual Anatomical Centers for Small-Scale Persons](https://arxiv.org/pdf/2208.11975)
- [Bottom-up Pose Estimation of Multiple Person with Bounding Box Constraint](https://arxiv.org/pdf/1807.09972)
- [BrushOff: Stroke-Based Re-rendering as a Watermark Removal Attack on Paintings](https://arxiv.org/html/2610.26682)
- [CDGNet: Class Distribution Guided Network for Human Parsing](https://arxiv.org/pdf/2111.14173)
- [CharacterGAN: Few-Shot Keypoint Character Animation and Reposing](https://arxiv.org/pdf/2102.03141)
- [Classification of Safety Driver Attention During Autonomous Vehicle Operation](https://arxiv.org/pdf/2310.11608)
- [Content Masked Loss: Human-Like Brush Stroke Planning in a Reinforcement Learning Painting Agent](https://arxiv.org/pdf/2012.10043)
- [Convex Relaxation for Robust Vanishing Point Estimation in Manhattan World](https://arxiv.org/pdf/2505.04788)
- [Convex Relaxation for Robust Vanishing Point Estimation in Manhattan World](https://arxiv.org/html/2505.04788v1)
- [Correlating Edge, Pose with Parsing](https://arxiv.org/pdf/2005.01431)
- [CTRL-C: Camera calibration TRansformer with Line-Classification](https://arxiv.org/pdf/2109.02259)
- [DC-SAM: In-Context Segment Anything in Images and Videos via Dual Consistency](https://arxiv.org/pdf/2504.12080)
- [Deep Learning Assisted Optimization for 3D Reconstruction from Single 2D Line Drawings](https://arxiv.org/pdf/2209.02692)
- [Deep Learning for Camera Calibration and Beyond: A Survey](https://arxiv.org/pdf/2303.10559)
- [Deep Learning for Vanishing Point Detection Using an Inverse Gnomonic Projection](https://arxiv.org/pdf/1707.02427)
- [Deep Single Image Camera Calibration by Heatmap Regression to Recover Fisheye Images Under Manhattan World Assumption](https://arxiv.org/html/2303.17166v2)
- [Deep vanishing point detection: Geometric priors make dataset variations vanish](https://arxiv.org/pdf/2203.08586)
- [DeepLSD: Line Segment Detection and Refinement with Deep Image Gradients](https://arxiv.org/pdf/2212.07766)
- [Detecting Dominant Vanishing Points in Natural Scenes with Application to Composition-Sensitive Image Retrieval](https://arxiv.org/pdf/1608.04267)
- [Detecting Vanishing Points using Global Image Context in a Non-Manhattan World](https://arxiv.org/pdf/1608.05684)
- [Divide and Fuse: Body Part Mesh Recovery from Partially Visible Human Images](https://arxiv.org/pdf/2407.09694)
- [End-to-end One-shot Human Parsing](https://arxiv.org/pdf/2105.01241)
- [Enhancing YOLO for Multi Person Pose Estimation Using ...](https://arxiv.org/pdf/2204.06806)
- [Exposing Deep Fakes Using Inconsistent Head Poses](https://arxiv.org/pdf/1811.00661)
- [Fine-Grained Head Pose Estimation Without Keypoints Nataniel Ruiz Eunji Chong](https://arxiv.org/pdf/1710.00925)
- [FishEyeRecNet: A Multi-Context Collaborative](https://arxiv.org/pdf/1804.04784)
- [Flow-Guided Controllable Line Drawing Generation](https://arxiv.org/pdf/2307.07540)
- [FrankMocap: A Monocular 3D Whole-Body Pose Estimation System via Regression and Integration](https://arxiv.org/pdf/2108.06428)
- [Full-body High-resolution Anime Generation with Progressive Structure-conditional Generative Adversarial Networks](https://arxiv.org/pdf/1809.01890)
- [Gaussian Building Mesh (GBM): Extract a Building's 3D Mesh with Google Earth and Gaussian Splatting](https://arxiv.org/pdf/2501.00625)
- [Generalized Object Detection on Fisheye Cameras for Autonomous Driving: Dataset, Representations and Baseline](https://arxiv.org/pdf/2012.02124)
- [Head Pose Estimation and 3D Neural Surface Reconstruction via Monocular Camera in situ for Navigation and Safe Insertion into Natural Openings](https://arxiv.org/pdf/2406.13048)
- [Human Mesh Recovery from Arbitrary Multi-view Images](https://arxiv.org/html/2403.12434v1)
- [Hybrid coarse-fine classification for head pose estimation](https://arxiv.org/pdf/1901.06778)
- [Image Cropping with Composition and Saliency Aware Aesthetic Score Map](https://arxiv.org/pdf/1911.10492)
- [Improving Multi-Person Pose Tracking with A Confidence ...](https://arxiv.org/pdf/2310.18920)
- [Indoor Frame Recovery from Refined Line Segments](https://arxiv.org/pdf/1705.00279)
- [Indoor Layout Estimation by 2D LiDAR and Camera Fusion](https://arxiv.org/pdf/2001.05422)
- [Instance-level Human Parsing via Part Grouping Network](https://arxiv.org/pdf/1808.00157)
- [Joint Geometric-Semantic Driven Character Line Drawing Generation](https://arxiv.org/html/2206.02998)
- [Learning 3D Texture-Aware Representations for Parsing Diverse Human Clothing and Body Parts](https://arxiv.org/pdf/2508.06032)
- [Learning More by Seeing Less: Line Drawing Pretraining for Efficient, Transferable, and Human-Aligned Vision](https://arxiv.org/html/2508.06696v1)
- [Learning More by Seeing Less: Structure-First Learning for Efficient, Transferable, and Human-Aligned Vision](https://arxiv.org/html/2508.06696v2)
- [Learning Regional Attraction for Line Segment Detection](https://arxiv.org/pdf/1912.09344)
- [Learning to Calibrate Straight Lines for Fisheye Image Rectification](https://arxiv.org/pdf/1904.09856)
- [Learning to generate line drawings that convey geometry and semantics](https://arxiv.org/pdf/2203.12691)
- [Learning to Paint With Model-based Deep Reinforcement Learning](https://arxiv.org/pdf/1903.04411)
- [Learning to Parse Wireframes in Images of Man-Made Environments](https://arxiv.org/pdf/2007.07527)
- [Learning to Reconstruct 3D Human Pose and Shape via Model-fitting in the Loop](https://arxiv.org/pdf/1909.12828)
- [Learning to Reconstruct 3D Manhattan Wireframes from a Single Image](https://arxiv.org/pdf/1905.07482)
- [Lester: rotoscope animation through video object segmentation and tracking](https://arxiv.org/pdf/2402.09883)
- [License: arXiv.org perpetual non-exclusive license](https://arxiv.org/html/2603.19538v1)
- [License: CC BY-NC-SA 4.0](https://arxiv.org/html/2312.05251v1)
- [Line Simplification](https://arxiv.org/pdf/1406.6660)
- [Look, Compare and Draw: Differential Query Transformer for Automatic Oil Painting](https://arxiv.org/pdf/2603.27720)
- [LPaintB: Learning to Paint from Self-Supervision](https://arxiv.org/pdf/1906.06841)
- [LSDNet: Trainable Modification of LSD Algorithm for Real-Time Line Segment Detection](https://arxiv.org/pdf/2209.04642)
- [Mastering Sketching: Adversarial Augmentation for Structured Prediction](https://arxiv.org/pdf/1703.08966)
- [Mesh-Aware Epipolar Matching for Multi-View Multi-Person 3D Pose Estimation in Basketball](https://arxiv.org/pdf/2605.29953)
- [MonoMVSNet: Monocular Priors Guided Multi-View Stereo Network](https://arxiv.org/pdf/2507.11333)
- [Multiview Multi-Person Human Mesh Recovery Under Large Scenes with Occlusions](https://arxiv.org/html/2607.24302)
- [Near-field Perception for Low-Speed Vehicle Automation using Surround-view Fisheye Cameras](https://arxiv.org/pdf/2103.17001)
- [On the Calibration of Human Pose Estimation](https://arxiv.org/pdf/2311.17105)
- [On the Use of Hierarchical Vision Foundation Modelsfor Low-Cost Human Mesh Recovery and Pose Estimation](https://arxiv.org/html/2510.12660)
- [Online Test-time Adaptation for 3D Human Pose Estimation:](https://arxiv.org/pdf/2503.11194)
- [Open Vocabulary Monocular 3D Object Detection](https://arxiv.org/html/2411.16833v1)
- [Paint Transformer: Feed Forward Neural Painting with Stroke Prediction](https://arxiv.org/pdf/2108.03798)
- [PAniC-3D: Stylized Single-view 3D Reconstruction from Portraits of Anime Characters](https://arxiv.org/pdf/2303.14587)
- [PARE: Part Attention Regressor for 3D Human Body Estimation](https://arxiv.org/pdf/2104.08527)
- [Personalized 3D Human Pose and Shape Refinement](https://arxiv.org/pdf/2403.11634)
- [Perspective (In)consistency of Paint by Text](https://arxiv.org/pdf/2206.14617)
- [Perspective Fields for Single Image Camera Calibration](https://arxiv.org/pdf/2212.03239)
- [Polygon Simplification by Minimizing Convex Corners](https://arxiv.org/pdf/1812.05656)
- [Polyp-SAM: Transfer SAM for Polyp Segmentation](https://arxiv.org/pdf/2305.00293)
- [Pose-guided Feature Disentangling for Occluded Person Re-identification Based on Transformer](https://arxiv.org/pdf/2112.02466)
- [Probabilistic Human Mesh Recovery in 3D Scenes from Egocentric Views](https://arxiv.org/pdf/2304.06024)
- [PromptHMR: Promptable Human Mesh Recovery](https://arxiv.org/html/2504.06397v1)
- [Quality-Aware Network for Human Parsing](https://arxiv.org/pdf/2103.05997)
- [Recovering 3D Human Mesh from Monocular Images: A Survey](https://arxiv.org/html/2203.01923v6)
- [Recurrence-based Vanishing Point Detection](https://arxiv.org/html/2412.20666v1)
- [Recurrence-based Vanishing Point Detection](https://arxiv.org/pdf/2412.20666)
- [ReDepth Anything: Test-Time Depth Refinement via Self-Supervised Re-lighting](https://arxiv.org/pdf/2512.17908)
- [RoboPEPP: Vision-Based Robot Pose and Joint Angle Estimation through Embedding Predictive Pre-Training](https://arxiv.org/pdf/2411.17662)
- [RTMW: Real-Time Multi-Person 2D and 3D Whole-body Pose Estimation](https://arxiv.org/pdf/2407.08634)
- [SAMAug: Point Prompt Augmentation for Segment Anything Model](https://arxiv.org/pdf/2307.01187)
- [SAMRefiner: Taming Segment Anything Model for Universal Mask Refinement](https://arxiv.org/pdf/2502.06756)
- [Sapiens: Foundation for Human Vision Models](https://arxiv.org/html/2408.12569v1)
- [SCHNet: SAM Marries CLIP for Human Parsing](https://arxiv.org/pdf/2503.22237)
- [See-through: Single-image Layer Decomposition for Anime Characters](https://arxiv.org/html/2602.03749)
- [Segment Using Just One Example](https://arxiv.org/pdf/2408.07393)
- [Selective Spatio-Temporal Aggregation Based Pose Refinement System: Towards Understanding Human Activities in Real-World Videos](https://arxiv.org/pdf/2011.05358)
- [Semi-Supervised Unconstrained Head Pose Estimation in the Wild](https://arxiv.org/html/2404.02544v2)
- [Simultaneous Facial Landmark Detection, Pose and Deformation Estimation under Facial Occlusion](https://arxiv.org/pdf/1709.08130)
- [Single Image Automatic Radial Distortion Compensation ...](https://arxiv.org/pdf/2112.08198)
- [SketchRodGS: Sketch-based Extraction of Slender Geometries for Animating Gaussian Splatting Scenes](https://arxiv.org/pdf/2601.02072)
- [Surround-View Cameras based Holistic Visual Perception for Automated Driving](https://arxiv.org/pdf/2206.05542)
- [Temporal Smoothing for 3D Human Pose Estimation and Localization for Occluded People](https://arxiv.org/pdf/2011.00250)
- [The Devil is in the Edges: Monocular Depth Estimation with Edge-aware Consistency Fusion](https://arxiv.org/pdf/2404.00373)
- [Towards High Performance Human Keypoint Detection](https://arxiv.org/pdf/2002.00537)
- [Transfer Learning for Pose Estimation of Illustrated Characters Shuhong Chen](https://arxiv.org/pdf/2108.01819)
- [Unite the People: Closing the Loop Between 3D and 2D Human Representations](https://arxiv.org/pdf/1701.02468)
- [Unsupervised Learning of Depth, Optical Flow and Pose with Occlusion from 3D Geometry](https://arxiv.org/pdf/2003.00766)
- [Vanishing Point Estimation in Uncalibrated Images with Prior Gravity Direction](https://arxiv.org/pdf/2308.10694)
- [View-Invariant, Occlusion-Robust Probabilistic Embedding for Human Pose](https://arxiv.org/pdf/2010.13321)
- [When SAM2 Meets Video Shadow and Mirror Detection](https://arxiv.org/pdf/2412.19293)
- [Wide-angle Image Rectification: A Survey](https://arxiv.org/pdf/2011.12108)

### openaccess.thecvf.com (22)

- [A Multi-Context Collaborative Deep Network for Fisheye ...](https://openaccess.thecvf.com/content_ECCV_2018/papers/Xiaoqing_Yin_FishEyeRecNet_A_Multi-Context_ECCV_2018_paper.pdf)
- [Antunes A Global Approach 2013 CVPR paper](https://openaccess.thecvf.com/content_cvpr_2013/papers/Antunes_A_Global_Approach_2013_CVPR_paper.pdf)
- [Blind Geometric Distortion Correction on Images Through Deep Learning](https://openaccess.thecvf.com/content_CVPR_2019/papers/Li_Blind_Geometric_Distortion_Correction_on_Images_Through_Deep_Learning_CVPR_2019_paper.pdf)
- [CDGNet: Class Distribution Guided Network for Human Parsing](https://openaccess.thecvf.com/content/CVPR2022/papers/Liu_CDGNet_Class_Distribution_Guided_Network_for_Human_Parsing_CVPR_2022_paper.pdf)
- [Deep Single Fisheye Image Camera Calibration for Over 180-degree](https://openaccess.thecvf.com/content/ICCV2021W/PBDL/papers/Wakai_Deep_Single_Fisheye_Image_Camera_Calibration_for_Over_180-Degree_Projection_ICCVW_2021_paper.pdf)
- [Deep vanishing point detection: Geometric priors make dataset variations vanish](https://openaccess.thecvf.com/content/CVPR2022/papers/Lin_Deep_Vanishing_Point_Detection_Geometric_Priors_Make_Dataset_Variations_Vanish_CVPR_2022_paper.pdf)
- [DeepLSD: Line Segment Detection and Refinement With Deep Image Gradients](https://openaccess.thecvf.com/content/CVPR2023/html/Pautrat_DeepLSD_Line_Segment_Detection_and_Refinement_With_Deep_Image_Gradients_CVPR_2023_paper.html)
- [Finding Vanishing Points via Point Alignments in Image Primal and Dual](https://openaccess.thecvf.com/content_cvpr_2014/papers/Lezama_Finding_Vanishing_Points_2014_CVPR_paper.pdf)
- [Fine-Grained Head Pose Estimation Without Keypoints Nataniel Ruiz Eunji Chong](https://openaccess.thecvf.com/content_cvpr_2018_workshops/papers/w41/Ruiz_Fine-Grained_Head_Pose_CVPR_2018_paper.pdf)
- [Hong Composing Photos Like a Photographer CVPR 2021 paper](https://openaccess.thecvf.com/content/CVPR2021/papers/Hong_Composing_Photos_Like_a_Photographer_CVPR_2021_paper.pdf)
- [Learning to generate line drawings that convey geometry and semantics](https://openaccess.thecvf.com/content/CVPR2022/papers/Chan_Learning_To_Generate_Line_Drawings_That_Convey_Geometry_and_Semantics_CVPR_2022_paper.pdf)
- [Part-aware Context Network for Human Parsing Xiaomei Zhang Yingying Chen](https://openaccess.thecvf.com/content_CVPR_2020/papers/Zhang_Part-Aware_Context_Network_for_Human_Parsing_CVPR_2020_paper.pdf)
- [Pautrat DeepLSD Line Segment Detection and Refinement With Deep Image Gradients CVPR 2023 paper](https://openaccess.thecvf.com/content/CVPR2023/papers/Pautrat_DeepLSD_Line_Segment_Detection_and_Refinement_With_Deep_Image_Gradients_CVPR_2023_paper.pdf)
- [PromptHMR: Promptable Human Mesh Recovery Yufu Wang1,4 Yu Sun1 Priyanka Patel1](https://openaccess.thecvf.com/content/CVPR2025/papers/Wang_PromptHMR_Promptable_Human_Mesh_Recovery_CVPR_2025_paper.pdf)
- [Real-time 3D Head Pose and Facial Landmark Estimation from Depth Images](https://openaccess.thecvf.com/content_cvpr_2015/papers/Papazov_Real-Time_3D_Head_2015_CVPR_paper.pdf)
- [Recurrence-Based Vanishing Point Detection](https://openaccess.thecvf.com/content/WACV2025/html/Bharadwaj_Recurrence-Based_Vanishing_Point_Detection_WACV_2025_paper.html)
- [SAM 3D Body: Robust Full-Body Human Mesh Recovery](https://openaccess.thecvf.com/content/CVPR2026/papers/Yang_SAM_3D_Body_Robust_Full-Body_Human_Mesh_Recovery_CVPR_2026_paper.pdf)
- [Selective Spatio-Temporal Aggregation Based Pose Reﬁnement System: Towards](https://openaccess.thecvf.com/content/WACV2021/papers/Yang_Selective_Spatio-Temporal_Aggregation_Based_Pose_Refinement_System_Towards_Understanding_Human_WACV_2021_paper.pdf)
- [Transfer Learning for Pose Estimation of Illustrated Characters Shuhong Chen](https://openaccess.thecvf.com/content/WACV2022/papers/Chen_Transfer_Learning_for_Pose_Estimation_of_Illustrated_Characters_WACV_2022_paper.pdf)
- [Unsupervised Discovery of Facial Landmarks and Head Pose Satyajit Tourani∗1](https://openaccess.thecvf.com/content/CVPR2025/papers/Tourani_Unsupervised_Discovery_of_Facial_Landmarks_and_Head_Pose_CVPR_2025_paper.pdf)
- [Unsupervised intrinsic calibration from a single frame using a ”plumb-line”](https://openaccess.thecvf.com/content_iccv_2013/papers/Melo_Unsupervised_Intrinsic_Calibration_2013_ICCV_paper.pdf)
- [Xu A Minimum Error 2013 CVPR paper](https://openaccess.thecvf.com/content_cvpr_2013/papers/Xu_A_Minimum_Error_2013_CVPR_paper.pdf)

### researchgate.net (8)

- [(PDF) CRITICAL ASSESSMENT OF CORRECTION METHODS FOR FISHEYE LENS DISTORTION](https://www.researchgate.net/publication/303800062_CRITICAL_ASSESSMENT_OF_CORRECTION_METHODS_FOR_FISHEYE_LENS_DISTORTION)
- [(PDF) Deep Learning for Vanishing Point Detection Using an Inverse Gnomonic Projection](https://www.researchgate.net/publication/318337003_Deep_Learning_for_Vanishing_Point_Detection_Using_an_Inverse_Gnomonic_Projection)
- [(PDF) Equidistant fish-eye perspective with application in distortion centre estimation](https://www.researchgate.net/publication/222827655_Equidistant_fish-eye_perspective_with_application_in_distortion_centre_estimation)
- [(PDF) Robust Radial Distortion from a Single Image](https://www.researchgate.net/publication/220844848_Robust_Radial_Distortion_from_a_Single_Image)
- [Automatic Radial Distortion Estimation from a Single Image](https://www.researchgate.net/publication/257581781_Automatic_Radial_Distortion_Estimation_from_a_Single_Image)
- [DeepVP: Deep Learning for Vanishing Point Detection on 1 Million Street View Images](https://www.researchgate.net/publication/327814235_DeepVP_Deep_Learning_for_Vanishing_Point_Detection_on_1_Million_Street_View_Images)
- [Pose estimation of anime/manga characters: a case for synthetic data](https://www.researchgate.net/publication/312512750_Pose_estimation_of_animemanga_characters_a_case_for_synthetic_data)
- [Transfer Learning for Pose Estimation of Illustrated Characters](https://www.researchgate.net/publication/358623933_Transfer_Learning_for_Pose_Estimation_of_Illustrated_Characters)

### ar5iv.labs.arxiv.org (8)

- [(1808.00157) Instance-level Human Parsing via Part Grouping Network](https://ar5iv.labs.arxiv.org/html/1808.00157)
- [(1904.09856) Learning to Calibrate Straight Lines for Fisheye Image Rectification](https://ar5iv.labs.arxiv.org/html/1904.09856)
- [(2108.01819) Transfer Learning for Pose Estimation of Illustrated Characters](https://ar5iv.labs.arxiv.org/html/2108.01819)
- [(2112.08930) Intelli-Paint: Towards Developing Human-like Painting Agents](https://ar5iv.labs.arxiv.org/html/2112.08930)
- [(2203.12691) Learning to generate line drawings that convey geometry and semantics](https://ar5iv.labs.arxiv.org/html/2203.12691)
- [(2303.05675) HumanBench: Towards General Human-centric Perception with Projector Assisted Pretraining](https://ar5iv.labs.arxiv.org/html/2303.05675)
- [A Geometry-Sensitive Approach for Photographic Style Classification](https://ar5iv.labs.arxiv.org/html/1909.01040)
- [ar5iv.labs.arxiv.org](https://ar5iv.labs.arxiv.org/html/2409.06704)

### ncbi.nlm.nih.gov (6)

- [A Novel Line Space Voting Method for Vanishing-Point Detection of General Road Images](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4970002/)
- [Hough Transform and Clustering for a 3-D Building Reconstruction with Tomographic SAR Point Clouds](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6960941/)
- [ROM-Pose: restoring occluded mask image for 2D human pose estimation](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12192664/)
- [Vanishing Point Detection Method Based on Constrained Classification for Checkpoints on Urban Roads](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9289364/)
- [Vanishing Point Extraction and Refinement for Robust Camera Calibration](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5795906/)
- [Whole-Body 3D Pose Estimation Based on Body Mass Distribution and Center of Gravity Constraints](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12251671/)

### ojs.aaai.org (4)

- [End-to-End Real-Time Vanishing Point Detection with Transformer](https://ojs.aaai.org/index.php/AAAI/article/view/28331)
- [ojs.aaai.org](https://ojs.aaai.org/index.php/AAAI/article/download/6889/6743)
- [Towards Light-Weight and Real-Time Line Segment Detection](https://ojs.aaai.org/index.php/AAAI/article/view/19953)
- [VPDETR: End-to-End Vanishing Point DEtection TRansformers](https://ojs.aaai.org/index.php/AAAI/article/view/27881)

### ecva.net (2)

- [GeoCalib: Learning Single-image Calibration with Geometric Optimization](https://www.ecva.net/papers/eccv_2024/papers_ECCV/html/5636_ECCV_2024_paper.php)
- [Multi-HMR: Multi-Person Whole-Body Human Mesh Recovery in a Single Shot](https://www.ecva.net/papers/eccv_2024/papers_ECCV/papers/03364.pdf)

### mlanthology.org (2)

- [GeoCalib: Learning Single-Image Calibration with Geometric Optimization](https://mlanthology.org/eccv/2024/veicht2024eccv-geocalib)
- [Towards Light-Weight and Real-Time Line Segment Detection](https://mlanthology.org/aaai/2022/gu2022aaai-light/)

### arxivlens.com (2)

- [CLIPasso: Semantically-Aware Object Sketching](https://arxivlens.com/PaperView/Details/clipasso-semantically-aware-object-sketching-2351-1753248)
- [mhr momentum human rig 1431 d159458d](https://arxivlens.com/PaperView/ViewPdf/mhr-momentum-human-rig-1431-d159458d)

### web3.arxiv.org (2)

- [web3.arxiv.org](https://web3.arxiv.org/pdf/2312.05251)
- [web3.arxiv.org](https://web3.arxiv.org/pdf/1909.12828)

### cvpr.thecvf.com (2)

- [cvpr.thecvf.com](https://cvpr.thecvf.com/virtual/2024/poster/30050)
- [DeepLSD: Line Segment Detection and Refinement With Deep Image Gradients](https://cvpr.thecvf.com/virtual/2023/poster/22052)

### pdfs.semanticscholar.org (1)

- [CRITICAL ASSESSMENT OF CORRECTION METHODS FOR FISHEYE LENS DISTORTION](https://pdfs.semanticscholar.org/0c10/96d9d2246cf80ca25d523f333b81b26a9165.pdf)

### semanticscholar.org (1)

- [(PDF) Automatic Radial Distortion Estimation from a Single Image](https://www.semanticscholar.org/paper/Automatic-Radial-Distortion-Estimation-from-a-Image-Bukhari-Dailey/16048a04665a8cddd179a939d6cbeb4e0cdb6672)

### ar5iv.arxiv.org (1)

- [ar5iv.arxiv.org](https://ar5iv.arxiv.org/html/2202.05822)

### content.ieeevis.org (1)

- [CLIPasso: Semantically Aware Object Sketching](https://content.ieeevis.org/year/2022/paper_v-siggraph-2.html)

### aaai-2022.virtualchair.net (1)

- [Towards Light-Weight and Real-Time Line Segment Detection](https://aaai-2022.virtualchair.net/poster_aaai1499)

### arxiv.deeppaper.ai (1)

- [Recurrence-based Vanishing Point Detection](https://arxiv.deeppaper.ai/papers/2412.20666v2)

### openaccess.thecvf.com:443 (1)

- [Chen Transfer Learning for Pose Estimation of Illustrated Characters WACV 2022 paper](https://openaccess.thecvf.com:443/content/WACV2022/papers/Chen_Transfer_Learning_for_Pose_Estimation_of_Illustrated_Characters_WACV_2022_paper.pdf)

### neurips.cc (1)

- [Draw This First](https://neurips.cc/virtual/2026/160707)

### springerprofessional.de (1)

- [springerprofessional.de](https://www.springerprofessional.de/doi/10.1145/2070781.2024167)

## Construcción orgánica (2026-11-17)

Dos investigaciones con etiqueta de origen por regla ([F] leída en la página, [S] solo fragmento de buscador, [CP] criterio propio, [D] derivada): `dev/investigacion-construccion/cuerpo.md` (gesto, masas, solapes, escorzo, estilos, NPR) y `dev/investigacion-construccion/cabeza-manos-pintura.md` (Loomis, Asaro, anime, caricatura, manos, valores y bordes, IA gratuita). Varias fuentes no se pudieron leer (lecciones de pago de Proko, Drawabox 403, PDFs de DeCarlo y Hertzmann, libros de Loomis y Bridgman): cada archivo lo dice. Enlaces:

- https://animationresources.org/drawing-drawing-100k-animation-drawing-course-02-squash-and-stretch-the-head/
- https://arxiv.org/abs/2006.10204
- https://content.e-bookshelf.de/media/reading/L-2552666-f20c0de73e.pdf
- https://cspages.ucalgary.ca/~blob/pdf/sousa-CGF-03.pdf
- https://ctrlpaint.com/videos/edges-bevels
- https://ctrlpaint.com/videos/painting-flat-values
- https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker
- https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker
- https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
- https://drawabox.com
- https://drawabox.com/
- https://education.siggraph.hosting.acm.org/static/HyperGraph/animation/character_animation/principles/squash_and_stretch.htm
- https://finearttutorials.com/guide/loomis-method/
- https://github.com/CMU-Perceptual-Computing-Lab/openpose
- https://github.com/IDEA-Research/DWPose
- https://github.com/carolineec/informative-drawings
- https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/hands.md
- https://github.com/lllyasviel/ControlNet
- https://gurneyjourney.blogspot.com/2011/08/transitioning-edges.html
- https://gurneyjourney.blogspot.com/2013/09/hard-and-soft-light.html
- https://gurneyjourney.blogspot.com/2014/07/plane-heads.html
- https://isgwww.cs.uni-magdeburg.de/~stefans/npr/entry-Hertzmann-2003-SSR.html
- https://jamesgurney.substack.com/p/plane-heads
- https://lifedrawing.academy/drawing-lessons/how-to-draw-hand-easy
- https://lifedrawing.academy/drawing-lessons/skull-drawing-easy
- https://line-of-action.com/article/gesture-basics-1-line-of-action/
- https://line-of-action.com/nl/article/gesture-basics-2-torso-and-hips
- https://pdf.arxiv.org/pdf/2110.03900
- https://pixl.cs.princeton.edu/pubs/DeCarlo_2003_SCF/index.php
- https://proko.com/community/topics/planes-of-the-head
- https://westcedarstudio.com/wp-content/uploads/2019/08/Figure-Drawing-for-All-Its-Worth.Andrew-Loomis.pdf
- https://www.awn.com/print/animationworld/vilppu-drawing-online-gesture
- https://www.cgtrader.com/3d-print-models/art/scans-replicas/planes-of-the-head-john-asaro-1976
- https://www.core77.com/posts/40869/
- https://www.cs.princeton.edu/courses/archive/fall00/cs597b/papers/hertzmann-zorin.pdf
- https://www.ctrlpaint.com/videos/tag/Ctrl-Paint+Unplugged
- https://www.dgp.toronto.edu/papers/ahertzmann_NPAR2002.pdf
- https://www.linearity.io/blog/12-principles-of-animation/
- https://www.nma.art/videolessons/introduction-to-gesture-and-figure-drawing/
- https://www.nma.art/videolessons/reilly-method-head-drawing-unit-1-anatomy/
- https://www.proko.com/course-lesson/anatomy-critiques-the-rib-cage
- https://www.proko.com/course-lesson/bean-examples-tilt-lean-twist-and-foreshortening
- https://www.proko.com/course-lesson/box-figure-drawings
- https://www.proko.com/course-lesson/cross-contour
- https://www.proko.com/course-lesson/edges-and-the-planes-of-the-head
- https://www.proko.com/course-lesson/hand-construction-1
- https://www.proko.com/course-lesson/hand-construction-2
- https://www.proko.com/course-lesson/how-to-control-the-edge
- https://www.proko.com/course-lesson/how-to-draw-cross-contour-on-3d-forms
- https://www.proko.com/course-lesson/how-to-draw-gesture
- https://www.proko.com/course-lesson/how-to-draw-with-line-weight
- https://www.proko.com/course-lesson/human-proportions-idealistic-figures
- https://www.proko.com/course-lesson/planes-and-forms-of-the-head/
- https://www.proko.com/course-lesson/the-shape-method-torso-arms-and-legs
- https://www.proko.com/robo-bean/
- https://www.proko.com/s/iiTr
- https://www.proko.com/the-bean/
- https://www.quickposes.com/en/
- https://www.skillshare.com/en/classes/figure-drawing-the-benefits-of-gesture/1606633741
- https://www.tensorflow.org/hub/tutorials/movenet
- https://www.tomrichmond.com/how-to-draw-caricatures-1-the-5-shapes/14/02/2008/
- https://www.tomrichmond.com/how-to-draw-caricatures-head-shapes/11/03/2008/
- https://www.tomrichmond.com/sunday-mailbag-reining-in-exaggeration/06/08/2017/
