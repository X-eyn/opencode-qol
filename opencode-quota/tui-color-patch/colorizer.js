// __quotaColorPatch__ Semantic colors for sidebar lines (input cyan, output green,
// percent/bars green-amber-red by remaining, countdowns accent).
function quotaSidebarLineSegments(line) {
  const muted = (theme) => theme.text.muted;
  const plain = (text) => ({ text, color: muted });
  const accent = (theme) => theme.text.action.primary.selected;
  const text = line ?? "";
  if (!text) return [{ text: " ", color: muted }];
  if (/^Session input\/out/u.test(text)) {
    return [{ text, color: (theme) => theme.text.base }];
  }
  const percentColor = (percent, mode) => {
    const remaining = mode === "used" ? 100 - percent : percent;
    return (theme) => {
      const t = theme.text;
      if (remaining < 30) return t.feedback.error.base;
      if (remaining < 70) return t.feedback.warning.base;
      return t.feedback.success.base;
    };
  };
  // Bar lines: optional indent, filled blocks, empty blocks, optional percent label.
  const barMatch = text.match(/^(\s*)([█]+)([░]*)(.*)$/u);
  if (barMatch) {
    const segments = [];
    if (barMatch[1]) segments.push(plain(barMatch[1]));
    const filled = barMatch[2];
    const empty = barMatch[3];
    const rest = barMatch[4];
    let percent;
    let mode;
    const restMatch = rest.match(/^(\s*)(\d+)%(\s*)(left|used)?\s*$/u);
    if (restMatch) {
      percent = Math.max(0, Math.min(100, Number(restMatch[2])));
      mode = restMatch[4];
    }
    const total = filled.length + empty.length;
    if (percent === undefined && total > 0) {
      percent = Math.round((filled.length / total) * 100);
    }
    const filledColor = percent === undefined ? muted : percentColor(percent, mode);
    segments.push({ text: filled, color: filledColor });
    if (empty) segments.push(plain(empty));
    if (rest) {
      if (restMatch) {
        if (restMatch[1]) segments.push(plain(restMatch[1]));
        segments.push({ text: `${restMatch[2]}%`, color: filledColor });
        if (restMatch[3]) segments.push(plain(restMatch[3]));
        if (restMatch[4]) segments.push(plain(restMatch[4]));
      } else {
        segments.push(plain(rest));
      }
    }
    return segments;
  }
  // Right-aligned countdown on its own line, or trailing a label.
  const tailRe = /^(.*?)(\s+)((?:\d+(?:\.\d+)?[dhms]\s*)+)\s*$/u;
  const tail = tailRe.exec(text);
  if (tail) {
    const countdown = tail[3].trimEnd();
    const groups = countdown.match(/\d+(?:\.\d+)?[dhms]/gu) || [];
    if (groups.length >= 2) {
      const segments = [];
      if (tail[1]) segments.push(plain(tail[1]));
      segments.push(plain(tail[2]));
      segments.push({ text: countdown, color: accent });
      return segments;
    }
  }
  // Percent-only line.
  const percentOnly = text.match(/^(\s*)(\d+)%(\s*)(left|used)?\s*$/u);
  if (percentOnly) {
    const segments = [];
    if (percentOnly[1]) segments.push(plain(percentOnly[1]));
    segments.push({
      text: `${percentOnly[2]}%`,
      color: percentColor(Number(percentOnly[2]), percentOnly[4]),
    });
    if (percentOnly[3]) segments.push(plain(percentOnly[3]));
    if (percentOnly[4]) segments.push(plain(percentOnly[4]));
    return segments;
  }
  // Session token counts: color input and output numbers.
  const segments = [];
  let coloredNumber = false;
  const re = /(\d+(?:\.\d+)?[KMB]?)|(\([\d.]+[KMB]?\))|(in|out)\b|\s+/gu;
  let index = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > index) segments.push(plain(text.slice(index, m.index)));
    index = m.index + m[0].length;
    if (m[1]) {
      const follow = text.slice(index).match(/^(?:\s*\([\d.]+[KMB]?\))?\s+(in|out)\b/u);
      if (follow) {
        coloredNumber = true;
        segments.push({
          text: m[1],
          color: (theme) => follow[1] === "in" ? theme.text.feedback.info.base : theme.text.feedback.success.base
        });
      } else {
        segments.push(plain(m[1]));
      }
    } else {
      segments.push(plain(m[0]));
    }
  }
  if (index < text.length) segments.push(plain(text.slice(index)));
  if (!coloredNumber) return [plain(text)];
  return segments;
}
// __quotaColorPatchEnd__
