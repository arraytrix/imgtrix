<script lang="ts">
  /**
   * Number field with always-visible stepper arrows.
   *
   * Chromium only shows its native spinner on hover and renders it in colours
   * that vanish against this UI, so the arrows are drawn here instead. Clicking
   * one moves the value by `step` (1 unless the caller says otherwise) and
   * fires real `input`/`change` events off the inner input, so parent handlers
   * that read `e.target.value` work exactly as they did before.
   */
  export let value: number | undefined = undefined
  export let min: number | undefined = undefined
  export let max: number | undefined = undefined
  export let step = 1
  export let variant: 'param' | 'wide' | 'dialog' = 'param'
  export let disabled = false

  let input: HTMLInputElement

  function nudge(direction: 1 | -1): void {
    const current = Number(input.value)
    let next = (Number.isFinite(current) ? current : 0) + direction * step
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    // Fractional steps otherwise accumulate float noise (0.30000000000000004).
    next = Number(next.toFixed(6))
    if (String(next) === input.value) return

    input.value = String(next)
    // `input` drives the internal binding, `change` is what callers listen for.
    input.dispatchEvent(new Event('input',  { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
</script>

<span class="num num--{variant}" class:disabled>
  <input
    bind:this={input}
    bind:value
    type="number"
    {min}
    {max}
    {step}
    {disabled}
    on:change
    on:input
  />
  <span class="steps">
    <button
      type="button"
      tabindex="-1"
      class="step step--up"
      aria-label="Increase"
      {disabled}
      on:mousedown|preventDefault
      on:click={() => nudge(1)}
    ></button>
    <button
      type="button"
      tabindex="-1"
      class="step step--down"
      aria-label="Decrease"
      {disabled}
      on:mousedown|preventDefault
      on:click={() => nudge(-1)}
    ></button>
  </span>
</span>

<style>
  .num {
    position: relative;
    display: inline-block;
    box-sizing: border-box;
  }
  .num--param  { width: 100%; }
  .num--wide   { width: 70px; }
  .num--dialog { width: 80px; }

  input {
    width: 100%;
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.09);
    color: #d4d4d4;
    text-align: right;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .num--param input,
  .num--wide input {
    border-radius: 5px;
    font-size: 11px;
    padding: 2px 15px 2px 4px;
  }
  .num--dialog input {
    border-radius: 6px;
    font-size: 12px;
    padding: 4px 17px 4px 6px;
  }
  input:focus {
    outline: none;
    border-color: rgba(86, 156, 214, 0.7);
    box-shadow: 0 0 0 2px rgba(86, 156, 214, 0.15);
  }
  /* Our own arrows replace the native spinner everywhere. */
  input::-webkit-outer-spin-button,
  input::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .steps {
    position: absolute;
    top: 1px;
    bottom: 1px;
    right: 1px;
    width: 13px;
    display: flex;
    flex-direction: column;
    /* Let clicks through to the input everywhere except the buttons. */
    pointer-events: none;
  }
  .num--dialog .steps { width: 15px; }

  .step {
    flex: 1;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    pointer-events: auto;
    position: relative;
    border-radius: 3px;
    transition: background 0.12s;
  }
  .step:hover { background: rgba(255, 255, 255, 0.1); }
  .step:active { background: rgba(86, 156, 214, 0.35); }

  /* Triangles drawn with borders — crisper than glyphs at this size. */
  .step::after {
    content: '';
    position: absolute;
    left: 50%;
    top: 50%;
    width: 0;
    height: 0;
    border-left: 3px solid transparent;
    border-right: 3px solid transparent;
  }
  .step--up::after {
    border-bottom: 4px solid rgba(212, 212, 212, 0.75);
    transform: translate(-50%, -60%);
  }
  .step--down::after {
    border-top: 4px solid rgba(212, 212, 212, 0.75);
    transform: translate(-50%, -40%);
  }
  .step:hover::after { border-bottom-color: #fff; border-top-color: #fff; }

  .num.disabled { opacity: 0.5; }
  .step:disabled { cursor: default; background: transparent; }
</style>
