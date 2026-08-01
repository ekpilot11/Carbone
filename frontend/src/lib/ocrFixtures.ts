/**
 * Verbatim OCR output captured from photographs of the clinic's printouts,
 * one sample per image-preprocessing variant. These are deliberately ugly:
 * they are what the recognizer really emits, and the parsers are expected
 * to cope with each of them. Do not "tidy" these strings.
 */

/** Keratometer strip: plain upscale. OD's pair is intact here. */
export const TOPO_V1 = `Voom
2026/07/23 ~~ |
| WN
ro; ¥
Last name )
First name
<R> Sim K's N |
45.06 7.49) Co
44. 16( 7.64) Q.
dk 0.90¢ 0, 15)
<L> Simk’s :
a4, "AREAS ‘) 17
A 43, 04 ( § O04, F of`;

/** Keratometer strip: contrast-stretched. Decimals split around the point. */
export const TOPO_V2 = `Yom
2026/07/93 ~~ |
ID: |
Last nama
First name : '
<R> g§ im K’'g N :
45 . 06 ( 7 . 49) ‘ |
44. 16¢( 7.64) Qu
dk 0.90¢ 0.15)
43.04( 7.84) of`;

/** Keratometer strip: thresholded. OD's first K is destroyed, OS's pair is intact. */
export const TOPO_V3 = `2026/07/23
10; .
Last Name ’
Firgy Name |
<R> Sim K's A
920.06( 7 aq) NM
44. 16¢ 7.64) 2
dk 0.90¢ 0.15)
<L> Sim K's A
44. 01 ( 7 on) 17
43, 04¢ J`;

/** A-scan printout: plain upscale. Note "22 .98" and the mangled eye header. */
export const BIO_V1 = `Hospita).
Sex Male M
NCD LENS —=
09.88 00.8 RL: =
Avg 02.79 04.71 15.49 22.98
AVGAXL= 22 .98mn
STDDEV =0.03mn
ACD =2.79mm
LENS =4.71mn
VITR =15.49nn
TUEL1..........1532 M/S`;

/** A-scan printout: contrast-stretched. The label itself reads "AVUGAXL". */
export const BIO_V2 = `Hospita
Sex {Ma |e ob M
ACD LENS =
Avg 92.79 04.71 15.49 22.98
AVUGAXL= 22 .98mn
STDDEV =0.03mm
ACD =2.79mn
LENS =4.71nmn`;

/** A-scan printout: thresholded. The label reads "AUGAXL"; no averages row. */
export const BIO_V3 = `Hospita).
Sex : Ma | 0b M
Cataract ode 25 108)
AUGAXL= 22 .98mn
STDDEV =0.03mn
ACD =2.79mn
LENS =4.71nn
VITR =15.49an`;

/** Both eyes on one printout, eye headers unreadable — print order decides. */
export const BIO_BOTH_EYES = `Hospita).
Sex Male M
AVGAXL= 22 .98mn
ACD =2.79mn
LENS =4.71mn
VITR =15.49mn
Hospita).
Sex Mae M
AVGAXL= 22 .65mn
ACD =2.59mn
LENS =4.71mn
VITR =15.35mn`;
