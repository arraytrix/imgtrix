<script lang="ts">
  export let text: string

  let visible = false
  let tipX = 0
  let tipY = 0

  function show(e: MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    tipX = rect.left
    tipY = rect.bottom + 7
    visible = true
  }

  function hide() { visible = false }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<span class="tip-icon" on:mouseenter={show} on:mouseleave={hide} aria-label={text}>?</span>

{#if visible}
  <div class="tip-box" style="left:{tipX}px;top:{tipY}px">{text}</div>
{/if}

<style>
  .tip-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.14);
    color: #555;
    font-size: 8px;
    font-weight: bold;
    font-style: normal;
    cursor: help;
    user-select: none;
    flex-shrink: 0;
    line-height: 1;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }

  .tip-icon:hover {
    color: #aaa;
    border-color: rgba(255, 255, 255, 0.28);
    background: rgba(255, 255, 255, 0.09);
  }

  .tip-box {
    position: fixed;
    background: rgba(18, 18, 26, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.09);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 8px 24px rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(20px) saturate(160%);
    color: #c0c0c0;
    font-size: 11px;
    font-weight: normal;
    text-transform: none;
    letter-spacing: normal;
    padding: 6px 9px;
    border-radius: 8px;
    max-width: 220px;
    z-index: 9999;
    pointer-events: none;
    line-height: 1.45;
  }
</style>
