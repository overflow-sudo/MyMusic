export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
    sampleRate: 48000,
  }
  if (deviceId) c.deviceId = { exact: deviceId }
  return c
}

export function videoConstraints(deviceId?: string): MediaTrackConstraints {
  const c: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30 },
  }
  if (deviceId) c.deviceId = { exact: deviceId }
  return c
}
