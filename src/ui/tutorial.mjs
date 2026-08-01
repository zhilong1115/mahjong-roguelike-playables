/**
 * 教学关：用真实界面走一副固定牌，逐步指出每样东西是什么。
 *
 * 三条设计原则：
 * 1. **用真界面，不做假演示。** 玩家学到的操作，就是正式局里的操作。
 * 2. **不会走错。** 除了被高亮的那一处，其余点击一律挡掉；需要选牌的步骤
 *    直接替玩家选好，他只需要按那一个按钮。所以脚本永远不会被玩家带偏。
 * 3. **随时能跳过。** 跳过按钮永远在最上层。
 *
 * 牌谱固定（见 `Run.loadScriptedHand`），因为教学的每一句话都在描述具体那几张牌，
 * 靠 seed 撞出来的牌一改平衡就对不上了。
 */

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** 教学专用牌谱：亮 111m → 求签 → 换掉東摸 9m → 胡。 */
export const TUTORIAL_SCRIPT = Object.freeze({
  hand: '111m 234m 567m 78m 99p E',
  wall: '9m 5p 3s 4s 6s',
  flavorId: 'mixed',
  swaps: 3,
});

/**
 * @param {object} deps
 * @param {import('../core/run.mjs').Run} deps.run
 * @param {() => void} deps.onFinish  跳过或走完都会调用
 */
export function createTutorial({ run, onFinish }) {
  let index = 0;
  let frame = null;
  let unsubscribe = null;
  let finished = false;
  let waitingForResult = false;

  const layer = el('div', 'coach');
  layer.id = 'coach';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-live', 'polite');
  // 四块遮罩围出一个「洞」，洞里那一处照常可点，其余全挡掉
  const masks = ['top', 'right', 'bottom', 'left'].map((side) => {
    const mask = el('div', `coachMask coachMask-${side}`);
    layer.append(mask);
    return mask;
  });
  const ring = el('div', 'coachRing');
  ring.setAttribute('aria-hidden', 'true');
  layer.append(ring);

  const card = el('div', 'coachCard');
  const step = el('div', 'coachStep');
  const title = el('div', 'coachTitle');
  const body = el('div', 'coachBody');
  const actions = el('div', 'coachActions');
  const nextButton = el('button', 'btn green', '下一步');
  nextButton.type = 'button';
  const skipButton = el('button', 'btn grey sm', '跳过教学');
  skipButton.type = 'button';
  actions.append(nextButton, skipButton);
  card.append(step, title, body, actions);
  layer.append(card);

  /** 选中手上所有某一种牌，让玩家只需要按那一个按钮。 */
  function selectKind(suit, rank, limit = 4) {
    run.clearSelection();
    const picks = run.looseTiles
      .filter((tile) => tile.suit === suit && tile.rank === rank)
      .slice(0, limit);
    for (const tile of picks) run.toggleTile(tile.id);
    run.emit();
  }

  const STEPS = [
    {
      title: '天胡 · 一分钟上手',
      body: '这是一局麻将构筑肉鸽。先陪你打一副，边打边说；随时可以跳过。',
    },
    {
      anchor: '#handZone',
      title: '你的手牌',
      body: '手上永远 14 张。凑成「四组面子 + 一对将」就算胡——面子是三张连号，或者三张一样的。',
    },
    {
      anchor: '#distV',
      title: '还差几张',
      body: '这里随时告诉你离胡还差几张。现在只差 1 张。',
    },
    {
      anchor: '#btnReveal',
      title: '亮组：本作的核心',
      body: '已经替你选好三张一萬。亮出来会花掉 1 次「签缘」，换来一次求签——构筑就是这么攒起来的。',
      enter: () => selectKind('man', 1, 3),
      done: (state) => state.revealedGroups.length > 0,
    },
    {
      anchor: '#draftCards',
      title: '求签：三选一',
      body: '灵签只在这一副生效。卡面会写清它是「立即生效」还是「收入锦囊」。挑一张。',
      done: (state) => !state.draft,
    },
    {
      anchor: '#slotBar',
      title: '签缘与锦囊',
      body: '左边是剩余签缘：没用完的，胡牌时换成金币——所以亮不亮组是要算的。右边三格放主动锦囊，需要时点一下就能用。',
    },
    {
      anchor: '#passiveSummary',
      title: '本副签效',
      body: '选中即生效的签效不占顶部格子，都收在这里。点开能看到这一副攒了哪些加成。',
    },
    {
      anchor: '#nextBox',
      title: '牌墙预览',
      body: '换牌之前就能看到接下来会摸到什么。下一张正好是九萬——也就是我们差的那张。',
    },
    {
      anchor: '#btnSwap',
      title: '换牌',
      body: '已经替你选好那张東。按「换牌」把它换掉；也可以直接把牌拖到按钮上松手。',
      enter: () => selectKind('honor', 1, 1),
      done: (state, context) => state.swapsRemaining < context.swapsAtStep,
    },
    {
      anchor: '#btnHu',
      title: '胡牌',
      body: '成牌了，胡牌按钮才会出现。按下去结算这一副。',
      done: (state) => state.status === 'hand-won',
    },
  ];

  const FINALE = {
    // 不挖洞：结算屏本身就是要读的内容，压暗它反而看不清。
    // 但仍然铺一层透明的挡板，免得玩家在教学里按到「本关结算」把这一局接着打下去。
    placement: 'bottom',
    dim: false,
    title: '教学完成',
    body: '得分 = 牌值 × 番势。正式局要连打几关，靠灵签、福将和牌骨把这两个数越滚越大。去主界面开一局吧。',
    finish: true,
    enter: () => {
      // 结算屏自己的按钮会把这一局接着打下去，教学里只留一个出口
      document.querySelector('#screen .rowBtns')?.setAttribute('hidden', '');
    },
  };

  let current = STEPS[0];
  const context = { swapsAtStep: run.swapsRemaining };

  function place() {
    frame = requestAnimationFrame(place);

    if (current.placement === 'bottom') {
      // 整屏一块挡板，透不透明由 dim 决定；说明卡钉在底部
      masks[0].style.cssText = `left:0;top:0;right:0;bottom:0;${current.dim === false ? 'background:transparent;' : ''}`;
      for (const mask of masks.slice(1)) mask.style.cssText = 'display:none;';
      ring.style.display = 'none';
      const cardBox = card.getBoundingClientRect();
      card.style.left = `${Math.max(8, (innerWidth - cardBox.width) / 2)}px`;
      card.style.top = `${Math.max(8, innerHeight - cardBox.height - 12)}px`;
      card.style.transform = 'none';
      return;
    }

    const anchor = current.anchor ? document.querySelector(current.anchor) : null;
    const rect = anchor?.getBoundingClientRect();
    const visible = rect && rect.width > 0 && rect.height > 0;

    if (!visible) {
      // 没有锚点（或锚点还没渲染出来）：整屏压暗，说明卡居中
      masks[0].style.cssText = 'left:0;top:0;right:0;bottom:0;';
      for (const mask of masks.slice(1)) mask.style.cssText = 'display:none;';
      ring.style.display = 'none';
      card.style.left = '50%';
      card.style.top = '50%';
      card.style.transform = 'translate(-50%,-50%)';
      return;
    }

    const pad = 8;
    const box = {
      left: Math.max(0, rect.left - pad),
      top: Math.max(0, rect.top - pad),
      right: Math.min(innerWidth, rect.right + pad),
      bottom: Math.min(innerHeight, rect.bottom + pad),
    };
    masks[0].style.cssText = `left:0;top:0;width:100%;height:${box.top}px;`;
    masks[1].style.cssText = `left:${box.right}px;top:${box.top}px;width:${Math.max(0, innerWidth - box.right)}px;height:${box.bottom - box.top}px;`;
    masks[2].style.cssText = `left:0;top:${box.bottom}px;width:100%;height:${Math.max(0, innerHeight - box.bottom)}px;`;
    masks[3].style.cssText = `left:0;top:${box.top}px;width:${box.left}px;height:${box.bottom - box.top}px;`;
    ring.style.display = 'block';
    ring.style.left = `${box.left}px`;
    ring.style.top = `${box.top}px`;
    ring.style.width = `${box.right - box.left}px`;
    ring.style.height = `${box.bottom - box.top}px`;

    // 说明卡放在洞的下方；下方放不下就翻到上方
    const cardRect = card.getBoundingClientRect();
    const below = box.bottom + 14;
    const above = box.top - cardRect.height - 14;
    const top = below + cardRect.height <= innerHeight - 8 ? below : Math.max(8, above);
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - cardRect.width / 2),
      Math.max(8, innerWidth - cardRect.width - 8),
    );
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    card.style.transform = 'none';
  }

  function render() {
    const total = STEPS.length;
    step.textContent = current.finish ? '完成' : `第 ${index + 1} / ${total} 步`;
    title.textContent = current.title;
    body.textContent = current.body;
    layer.dataset.step = current.anchor ?? 'center';
    // 有 done 条件的步骤要玩家自己动手，不给「下一步」
    nextButton.hidden = Boolean(current.done);
    nextButton.textContent = current.finish ? '进入主界面' : '下一步';
    skipButton.hidden = Boolean(current.finish);
  }

  function goTo(nextStep, nextIndex = index) {
    index = nextIndex;
    current = nextStep;
    context.swapsAtStep = run.swapsRemaining;
    render();
    current.enter?.();
  }

  function advance() {
    if (finished) return;
    if (current.finish) {
      finish();
      return;
    }
    if (index + 1 < STEPS.length) {
      goTo(STEPS[index + 1], index + 1);
      return;
    }
    // 最后一步做完了：等结算动画走完、结果屏出来，再收尾
    waitingForResult = true;
    layer.classList.add('waiting');
  }

  function onState(state) {
    if (finished) return;
    if (waitingForResult) {
      if (document.querySelector('#screen .screenBox')) {
        waitingForResult = false;
        layer.classList.remove('waiting');
        goTo(FINALE);
      }
      return;
    }
    if (current.done?.(state, context)) advance();
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (frame) cancelAnimationFrame(frame);
    unsubscribe?.();
    layer.remove();
    document.body.classList.remove('coaching');
    onFinish?.();
  }

  nextButton.addEventListener('click', advance);
  skipButton.addEventListener('click', finish);

  document.body.append(layer);
  document.body.classList.add('coaching');
  unsubscribe = run.subscribe(onState);
  goTo(STEPS[0], 0);
  frame = requestAnimationFrame(place);

  // 结算屏可能在没有新状态时才挂上来，补一个轮询兜底
  const poll = setInterval(() => {
    if (finished) {
      clearInterval(poll);
      return;
    }
    if (waitingForResult) onState(run.snapshot());
  }, 200);

  return { finish, get finished() { return finished; } };
}
