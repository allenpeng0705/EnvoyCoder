/// Pure paced-reveal policy — Dart twin of desktop `text-reveal.ts`.
library;

const textRevealHorizonMs = 150;
const textRevealFrameIntervalMs = 1000 / 60;
const _maxElapsedMs = 250;

class TextRevealState {
  const TextRevealState({required this.target, required this.revealed});
  final String target;
  final int revealed;
}

TextRevealState beginTextReveal(String text) => TextRevealState(target: text, revealed: text.length);

TextRevealState retargetTextReveal(TextRevealState state, String text) {
  if (state.target == text) return state;
  return TextRevealState(target: text, revealed: state.revealed.clamp(0, text.length));
}

int computeRevealStep({required int backlog, required double elapsedMs, int horizonMs = textRevealHorizonMs}) {
  if (backlog <= 0) return 0;
  if (horizonMs <= 0) return backlog;
  final elapsed = elapsedMs.clamp(0, _maxElapsedMs.toDouble());
  if (elapsed <= 0) return 0;
  if (elapsed >= horizonMs) return backlog;
  final step = ((backlog * elapsed) / horizonMs).ceil();
  return step.clamp(1, backlog);
}

TextRevealState advanceTextReveal(TextRevealState state, double elapsedMs) {
  final step = computeRevealStep(
    backlog: state.target.length - state.revealed,
    elapsedMs: elapsedMs,
  );
  if (step <= 0) return state;
  return TextRevealState(
    target: state.target,
    revealed: (state.revealed + step).clamp(0, state.target.length),
  );
}

TextRevealState completeTextReveal(TextRevealState state) {
  if (state.revealed >= state.target.length) return state;
  return TextRevealState(target: state.target, revealed: state.target.length);
}

bool isTextRevealSettled(TextRevealState state) => state.revealed >= state.target.length;

String visibleRevealedText(TextRevealState state) {
  if (state.revealed >= state.target.length) return state.target;
  // Character boundary is fine for UTF-16 Dart strings used here; grapheme clamp is best-effort.
  var end = state.revealed.clamp(0, state.target.length);
  if (end > 0 && end < state.target.length) {
    final unit = state.target.codeUnitAt(end - 1);
    if (unit >= 0xD800 && unit <= 0xDBFF) end -= 1;
  }
  return state.target.substring(0, end);
}
