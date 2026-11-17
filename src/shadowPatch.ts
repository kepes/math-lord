/**
 * Makes a shadow lookup cheap enough for a headset (carried over from the Gardrób VR viewer).
 *
 * three.js softens every shadow with five rotated samples per light and pixel. The cartoon look
 * here wants a crisp shadow anyway, so with a blur radius of 0 the patched shader takes a single
 * sample – which the GPU still filters over 2 × 2 texels.
 */
import * as THREE from 'three';

const FIVE_SAMPLES = /shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \)[\s\S]*?\) \* 0\.2;/;

const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
const match = FIVE_SAMPLES.exec(chunk);
/** False when a newer three.js words the shader differently: shadows still work, at full cost. */
export const shadowPatched = !!match;
if (match) {
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(
    match[0],
    `if ( shadowRadius <= 0.0 ) {

					shadow = texture( shadowMap, shadowCoord.xyz );

				} else {

					${match[0]}

				}`,
  );
}
