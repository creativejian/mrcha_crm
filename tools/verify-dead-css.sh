#!/bin/bash
# dead CSS 제거의 기계 검증 (#167 방식). baseline.css = 제거 전 빌드 산출, after.css = 제거 후.
#
# 단순 byte-diff는 쓸 수 없다: 결합 셀렉터에서 조각을 빼면 minifier가 같은 셀렉터의 두 블록을
# 접기 때문이다(계산값은 동일). 그래서 아래 3축으로 검증한다.
#   ① 제거 대상 클래스가 산출물에서 완전히 사라졌는가
#   ② live 클래스가 살아있고, 결합 셀렉터에서 살아남은 쪽의 **계산값**이 baseline과 같은가
#   ③ @keyframes 정의와 그 live 사용처가 유지되는가 (이름이 stage-status-*라고 dead가 아니다)
#
# 사용법:
#   git stash            # 또는 제거 전 커밋으로 checkout
#   bun run build && cp client/dist/assets/*.css /tmp/baseline.css
#   git stash pop        # 제거 적용
#   bun run build && cp client/dist/assets/*.css /tmp/after.css
#   bash tools/verify-dead-css.sh /tmp/baseline.css /tmp/after.css
#
# ⚠️ 아래 클래스 목록은 0709 배치 3의 customer-list.css 작업 기준이다.
#    다른 dead CSS 작업에 재사용할 때는 ①/② 목록을 그 작업의 제거/유지 대상으로 교체할 것.
set -u
B="${1:?baseline.css 경로가 필요합니다}"
A="${2:?after.css 경로가 필요합니다}"
fail=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then printf "  ✓ %s\n" "$1"; else printf "  ✗ %s\n     기대: %s\n     실제: %s\n" "$1" "$2" "$3"; fail=1; fi
}

echo "=== ① 제거 대상 클래스: after에서 0회 ==="
for c in col-source source-cell source-route source-received-at source-route-label \
         source-entry-type advisor-cell advisor-display advisor-copy advisor-name \
         advisor-team advisor-assigned-at advisor-change-pill operation-sub \
         stage-meta stage-signal stage-two-step-popover-title stage-status-group \
         stage-status-group-label stage-status-options stage-status-option \
         stage-status-popover chance-pill; do
  a=$(grep -oE "\.${c}([^-a-zA-Z0-9_]|$)" "$A" | wc -l | tr -d ' ')
  [ "$a" -eq 0 ] || { printf "  ✗ %s 가 after에 %s회 남음\n" "$c" "$a"; fail=1; }
done
[ "$fail" -eq 0 ] && echo "  ✓ 23개 클래스 전부 0회"

echo
echo "=== ② live 클래스 등장 횟수 불변 ==="
for c in customer-meta vehicle-trim customer-phone vehicle-method \
         stage-two-step-popover stage-two-step-option stage-two-step-options \
         stage-status-button chance-status-option chance-status-button \
         col-advisor col-operation operation-line-time extra-count-pill customer-name; do
  b=$(grep -oE "\.${c}([^-a-zA-Z0-9_]|$)" "$B" | wc -l | tr -d ' ')
  a=$(grep -oE "\.${c}([^-a-zA-Z0-9_]|$)" "$A" | wc -l | tr -d ' ')
  chk "$c (${b}회)" "$b" "$a"
done

echo
echo "=== ②-b .chance-status-popover: 블록이 접혔으므로 계산값으로 비교 ==="
# baseline은 2블록 캐스케이드, after는 1블록. 최종 적용되는 값이 같아야 한다.
for prop in "position:absolute" "z-index:160" "width:70px" "padding:6px" "animation:none" "display:grid" "left:0"; do
  a=$(grep -oE "\.chance-status-popover\{[^}]*\}" "$A" | grep -c "$prop")
  chk ".chance-status-popover 에 $prop" "1" "$a"
done
# baseline 첫 블록에만 있던 값 중 minifier가 접은 것(after에 없어야 정상)
for prop in "width:236px" "padding:8px"; do
  a=$(grep -oE "\.chance-status-popover\{[^}]*\}" "$A" | grep -c "$prop" || true)
  chk ".chance-status-popover 에 $prop 없음(덮이던 값)" "0" "$a"
done
# minifier가 접지 않고 둘 다 남긴 중복 선언 — CSS 캐스케이드상 **블록 내 마지막 값이 이긴다**.
# 따라서 "존재 여부"가 아니라 "마지막에 이기는 값"이 baseline과 같아야 한다.
blockA=$(grep -oE "\.chance-status-popover\{[^}]*\}" "$A")
blockB=$(grep -oE "\.chance-status-popover\{[^}]*\}" "$B" | tail -1) # baseline은 둘째 블록이 최종
chk "z-index 최종값" "$(echo "$blockB" | grep -oE 'z-index:[0-9]+' | tail -1)" "$(echo "$blockA" | grep -oE 'z-index:[0-9]+' | tail -1)"
chk "border 최종값"  "$(echo "$blockB" | grep -oE 'border:[^;}]+' | tail -1)"  "$(echo "$blockA" | grep -oE 'border:[^;}]+' | tail -1)"
chk "background 최종값" "$(echo "$blockB" | grep -oE 'background:[^;}]+' | tail -1)" "$(echo "$blockA" | grep -oE 'background:[^;}]+' | tail -1)"
chk "top 최종값" "$(echo "$blockB" | grep -oE 'top:[^;}]+' | tail -1)" "$(echo "$blockA" | grep -oE 'top:[^;}]+' | tail -1)"
chk "box-shadow 최종값" "$(echo "$blockB" | grep -oE 'box-shadow:[^;}]+' | tail -1)" "$(echo "$blockA" | grep -oE 'box-shadow:[^;}]+' | tail -1)"
# ::before 도 접힘 — 최종 display:none 유지
bb=$(grep -oE "\.chance-status-popover:before\{[^}]*\}" "$A" | grep -c "display:none")
chk ".chance-status-popover:before 에 display:none" "1" "$bb"

echo
echo "=== ③ @keyframes: 이름이 stage-status-* 지만 live 다 ==="
kd=$(grep -c "@keyframes stage-status-popover-in" "$A")
chk "@keyframes stage-status-popover-in 정의 존재" "1" "$kd"
ku=$(grep -oE "\.stage-two-step-popover\{[^}]*\}" "$A" | grep -c "stage-status-popover-in")
chk ".stage-two-step-popover 가 그 애니메이션 사용" "1" "$ku"

echo
echo "=== ④ :has() 셀렉터 — 조각만 빠지고 나머지 보존 ==="
h1=$(grep -c "tr:has(.stage-two-step-popover)" "$A")
h2=$(grep -c "tr:has(.chance-status-popover)" "$A")
h3=$(grep -c ".chance-control:has(.chance-status-popover)" "$A")
h4=$(grep -c "stage-two-step-stack:has(.stage-two-step-popover)" "$A")
chk "tr:has(.stage-two-step-popover) 보존" "1" "$h1"
chk "tr:has(.chance-status-popover) 보존" "1" "$h2"
chk ".chance-control:has(...) 보존" "1" "$h3"
chk ".stage-two-step-stack:has(...) 보존" "1" "$h4"

echo
echo "=== 규모 ==="
echo "  선언 블록: $(grep -o '{' "$B" | wc -l | tr -d ' ') -> $(grep -o '{' "$A" | wc -l | tr -d ' ')"
echo "  바이트:    $(wc -c < "$B") -> $(wc -c < "$A")"
echo
[ "$fail" -eq 0 ] && echo "✅ 전 항목 통과 — 시각 회귀 0" || echo "❌ 실패 항목 있음"
exit $fail
