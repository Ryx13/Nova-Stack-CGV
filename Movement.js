// Pure movement policy, shared with the tutorial and regression checks.
export function updateLocomotion(state, dt, forwardInput) {
  dt = Math.max(0, Math.min(dt, 0.05));
  if (state.playerStamina <= 0) state.staminaExhausted = true;
  if (state.staminaExhausted && state.playerStamina >= 25) state.staminaExhausted = false;
  const requested = !state.crouching && forwardInput > 0 &&
    !!(state.keys.ShiftLeft || state.keys.ShiftRight);
  state.isSprinting = requested && !state.staminaExhausted;
  state.playerStamina = Math.max(0, Math.min(100,
    state.playerStamina + dt * (state.isSprinting ? -11 : 22)));
  if (state.playerStamina === 0) {
    state.staminaExhausted = true;
    state.isSprinting = false;
  }
  const target = (state.isSprinting ? 8.4 : state.crouching ? 2.1 : 3.7) *
    (state.adrenalineActive ? 1.45 : 1);
  if (!Number.isFinite(state.currentSpeed)) state.currentSpeed = 3.7;
  state.currentSpeed += (target - state.currentSpeed) * (1 - Math.exp(-6 * dt));
}
