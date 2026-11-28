import { useEffect } from 'react'
import { lightBus } from '../light/lightBus'
import { hexSaturation, hexToHue, SAT_FLOOR } from '../light/lightMath'
import { effectiveLightColor, getLightColor, onLightColorChange } from '../light/lightPrefs'

/**
 * Song screen (bpm): free pulse at the song tempo and its hue. List (null): slow breath, default hue.
 * The light color is the song's own choice, else the global one, else auto (tempo hue).
 */
export function useSongLight(bpm: number | null, song?: { lightColor?: unknown } | null) {
  const songColor = song?.lightColor
  useEffect(() => {
    const apply = (global = getLightColor()) => {
      const c = effectiveLightColor(global, { lightColor: songColor })
      if (c) lightBus.setFixedHue(hexToHue(c), Math.max(SAT_FLOOR, hexSaturation(c)))
      else lightBus.setFixedHue(null)
    }
    apply()
    const off = onLightColorChange(apply)
    return () => {
      off()
      lightBus.setFixedHue(null)
    }
  }, [songColor])

  useEffect(() => {
    lightBus.setHueBpm(bpm)
    if (bpm === null) lightBus.setSource({ kind: 'breath' })
    // A running take owns the beat; the Recorder hands it back when the take settles.
    else if (lightBus.getSource().kind !== 'take') lightBus.setSource({ kind: 'free', bpm })
  }, [bpm])
}
