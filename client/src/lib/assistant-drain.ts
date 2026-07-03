// 중지 시 부분 답변에 붙는 suffix — 서버 src/lib/assistant-stream.ts의 STOP_SUFFIX와 동일 값 유지
// (서버 테스트의 파리티 케이스가 드리프트를 잡는다). 클라는 중지 직후 임시 표시에만 사용.
export const STOP_SUFFIX = " (중단됨)";

// 앱 chat_streaming_controller.dart의 디스플레이 드레인 페이싱 미러 — 실사용 검증된 타자기 수치.
export const DRAIN_TICK_MS = 38;
const INTRO_STEP = 2; // 표시 <72자: 천천히 시작
const SLOW_STEP = 4; // 표시 <160자, 그리고 꼬리(잔여 ≤56자)
const MEDIUM_STEP = 7; // 잔여 >56자
const FAST_STEP = 11; // 잔여 >160자

const isHighSurrogate = (u: number) => u >= 0xd800 && u <= 0xdbff;
const isLowSurrogate = (u: number) => u >= 0xdc00 && u <= 0xdfff;

// 다음 틱에 표시할 길이. UTF-16 서로게이트 페어 중간에서 자르지 않는다(페어를 함께 노출).
// 불변조건: currentLength는 반드시 이 함수의 이전 반환값(또는 0)이어야 한다 — 임의 값은 서로게이트 안전 경계를 보장하지 않는다.
export function nextDisplayLength(target: string, currentLength: number): number {
  if (currentLength >= target.length) return target.length;
  const remaining = target.length - currentLength;
  const step =
    currentLength < 72
      ? INTRO_STEP
      : currentLength < 160
        ? SLOW_STEP
        : remaining > 160
          ? FAST_STEP
          : remaining > 56
            ? MEDIUM_STEP
            : SLOW_STEP;
  let next = Math.min(currentLength + step, target.length);
  if (next < target.length && next > 0 && isHighSurrogate(target.charCodeAt(next - 1)) && isLowSurrogate(target.charCodeAt(next)))
    next += 1;
  return next;
}
