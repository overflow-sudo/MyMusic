import { useEffect } from 'react'
import { lightBus } from '../light/lightBus'

/** Song screen (bpm): free pulse at the song tempo and its hue. List (null): slow breath, default hue. */
export function useSongLight(bpm: number | null) {
  useEffect(() => {
    lightBus.setHueBpm(bpm)
    if (bpm === null) lightBus.setSource({ kind: 'breath' })
    // A running take owns the beat; the Recorder hands it back when the take settles.
    else if (lightBus.getSource().kind !== 'take') lightBus.setSource({ kind: 'free', bpm })
  }, [bpm])
}
