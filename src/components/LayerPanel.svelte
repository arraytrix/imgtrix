<script lang="ts">
  import { layerStack, layerTick, bump, menuAction } from '../store'
  import type { Layer } from '../engine/layer'

  // Reactive layer list: top of stack displayed at top of panel (reversed)
  $: displayLayers = ($layerTick, [...$layerStack.layers].reverse())
  $: activeId = ($layerTick, $layerStack.active.id)

  function addLayer(): void {
    $layerStack.add()
    bump()
  }

  function removeLayer(id: string): void {
    const layer = $layerStack.layers.find(l => l.id === id)
    if (!layer) return
    const isBackground = $layerStack.layers[0].id === id
    if (isBackground) {
      if (layer.modified && !confirm(`Clear background layer "${layer.name}"? This cannot be undone.`)) return
      layer.clear()
      layer.modified = false
      bump()
      menuAction.set('render')
      return
    }
    if (layer.modified && !confirm(`Delete layer "${layer.name}"? This cannot be undone.`)) return
    $layerStack.remove(id)
    bump()
    menuAction.set('render')
  }

  function setActive(id: string): void {
    $layerStack.setActive(id)
    bump()
  }

  function toggleVisible(layer: Layer): void {
    layer.visible = !layer.visible
    bump()
    menuAction.set('render')
  }

  function moveUp(id: string): void {
    $layerStack.moveUp(id)
    bump()
  }

  function moveDown(id: string): void {
    $layerStack.moveDown(id)
    bump()
  }

  function setOpacity(layer: Layer, value: string): void {
    layer.opacity = Number(value) / 100
    bump()
  }
</script>

<aside class="layer-panel">
  <header>
    <span>Layers</span>
    <button on:click={addLayer} title="Add layer">+</button>
  </header>

  <ul>
    {#each displayLayers as layer (layer.id)}
      <li
        class:active={layer.id === activeId}
        on:click={() => setActive(layer.id)}
        on:keydown={(e) => e.key === 'Enter' && setActive(layer.id)}
        role="option"
        aria-selected={layer.id === activeId}
        tabindex="0"
      >
        <button
          class="vis-btn"
          on:click|stopPropagation={() => toggleVisible(layer)}
          title={layer.visible ? 'Hide layer' : 'Show layer'}
        >
          {layer.visible ? '👁' : '○'}
        </button>

        <span class="layer-name">{layer.name}</span>

        <div class="layer-actions" on:click|stopPropagation={() => {}}>
          <button on:click={() => moveUp(layer.id)} title="Move up">↑</button>
          <button on:click={() => moveDown(layer.id)} title="Move down">↓</button>
          <button on:click={() => removeLayer(layer.id)} title={$layerStack.layers[0].id === layer.id ? 'Clear layer' : 'Delete layer'}>×</button>
        </div>
      </li>

      {#if layer.id === activeId}
        <li class="opacity-row">
          <label>
            Opacity
            <input
              type="range" min="0" max="100"
              value={Math.round(layer.opacity * 100)}
              on:input={(e) => setOpacity(layer, e.currentTarget.value)}
            />
            {Math.round(layer.opacity * 100)}%
          </label>
        </li>
      {/if}
    {/each}
  </ul>
</aside>

<style>
  .layer-panel {
    width: 220px;
    background: rgba(22, 22, 28, 0.96);
    border-left: 1px solid rgba(255, 255, 255, 0.07);
    box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.03);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    flex-shrink: 0;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
    font-weight: 600;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #888;
  }

  header button {
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.10);
    color: #d4d4d4;
    width: 22px;
    height: 22px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    transition: background 0.15s;
  }

  header button:hover { background: rgba(255, 255, 255, 0.13); }

  ul {
    list-style: none;
    overflow-y: auto;
    flex: 1;
  }

  li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    user-select: none;
    transition: background 0.12s;
  }

  li:hover { background: rgba(255, 255, 255, 0.04); }
  li.active {
    background: rgba(86, 156, 214, 0.11);
    border-left: 2px solid rgba(86, 156, 214, 0.6);
    padding-left: 6px;
  }

  .layer-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }

  .vis-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 13px;
    padding: 0;
    color: #d4d4d4;
    width: 18px;
  }

  .layer-actions {
    display: flex;
    gap: 2px;
  }

  .layer-actions button {
    background: none;
    border: none;
    color: #666;
    cursor: pointer;
    font-size: 12px;
    padding: 1px 3px;
    border-radius: 4px;
    transition: background 0.12s, color 0.12s;
  }

  .layer-actions button:hover:not(:disabled) { color: #d4d4d4; background: rgba(255, 255, 255, 0.09); }
  .layer-actions button:disabled { opacity: 0.25; cursor: default; }

  .opacity-row {
    background: rgba(0, 0, 0, 0.18);
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    cursor: default;
  }

  .opacity-row label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #888;
    width: 100%;
  }

  .opacity-row input[type="range"] {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    cursor: pointer;
    height: 18px;
  }

  .opacity-row input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 4px;
    background: rgba(160, 200, 240, 0.18);
    border: 1px solid rgba(140, 190, 235, 0.20);
    box-shadow:
      inset 0 1px 2px rgba(0, 0, 0, 0.40),
      inset 0 -1px 0 rgba(255, 255, 255, 0.06);
  }

  .opacity-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    margin-top: -6px;
    background: linear-gradient(
      155deg,
      rgba(200, 230, 255, 0.55) 0%,
      rgba(100, 170, 225, 0.95) 38%,
      rgba(42, 120, 195, 1.0) 100%
    );
    border: 1px solid rgba(20, 70, 140, 0.85);
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.50),
      inset 0 -1px 0 rgba(0, 0, 0, 0.28);
    transition: transform 0.1s, box-shadow 0.1s;
  }

  .opacity-row input[type="range"]::-webkit-slider-thumb:hover {
    transform: scale(1.18);
    box-shadow:
      0 3px 10px rgba(0, 0, 0, 0.65),
      0 0 0 3px rgba(86, 156, 214, 0.28),
      inset 0 1px 0 rgba(255, 255, 255, 0.55),
      inset 0 -1px 0 rgba(0, 0, 0, 0.28);
  }

  .opacity-row input[type="range"]::-moz-range-track {
    height: 4px;
    border-radius: 4px;
    background: rgba(160, 200, 240, 0.18);
    border: 1px solid rgba(140, 190, 235, 0.20);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.40);
  }

  .opacity-row input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: linear-gradient(
      155deg,
      rgba(200, 230, 255, 0.55) 0%,
      rgba(100, 170, 225, 0.95) 38%,
      rgba(42, 120, 195, 1.0) 100%
    );
    border: 1px solid rgba(20, 70, 140, 0.85);
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.55),
      inset 0 1px 0 rgba(255, 255, 255, 0.50),
      inset 0 -1px 0 rgba(0, 0, 0, 0.28);
  }
</style>
