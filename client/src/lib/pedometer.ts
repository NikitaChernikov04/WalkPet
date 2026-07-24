// Simple peak-detection pedometer over the accelerometer's magnitude signal.
// Not lab-accurate, but good enough for a prototype's game feel.

const PEAK_THRESHOLD = 1.2; // m/s^2 above resting gravity noise
const MIN_STEP_INTERVAL_MS = 250; // reject double-counts from a single footfall

export type PedometerPermission = "unsupported" | "granted" | "denied" | "prompt";

export async function requestMotionPermission(): Promise<PedometerPermission> {
  const DeviceMotionEventTyped = DeviceMotionEvent as unknown as {
    requestPermission?: () => Promise<"granted" | "denied">;
  };
  if (typeof DeviceMotionEventTyped.requestPermission === "function") {
    try {
      const result = await DeviceMotionEventTyped.requestPermission();
      return result === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  }
  // Most Android browsers expose motion events without an explicit permission prompt.
  return typeof DeviceMotionEvent !== "undefined" ? "granted" : "unsupported";
}

export function startPedometer(onStep: () => void): () => void {
  let lastMagnitude = 0;
  let lastStepAt = 0;
  let rising = false;

  const handleMotion = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

    const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
    const delta = magnitude - lastMagnitude;
    lastMagnitude = magnitude;

    const now = Date.now();
    if (delta > PEAK_THRESHOLD && !rising && now - lastStepAt > MIN_STEP_INTERVAL_MS) {
      rising = true;
      lastStepAt = now;
      onStep();
    } else if (delta < 0) {
      rising = false;
    }
  };

  window.addEventListener("devicemotion", handleMotion);
  return () => window.removeEventListener("devicemotion", handleMotion);
}
