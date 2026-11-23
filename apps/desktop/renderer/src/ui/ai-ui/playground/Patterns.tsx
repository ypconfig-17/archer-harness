import { useMemo, useState } from "react";
import { Button, ConversationViewport, InteractionCard, Textarea } from "@archer/ui";
import { EventTimeline } from "../../workspace/EventTimeline";
import { CurrentPlan } from "../../workspace/CurrentPlan";
import { patternEvents, type PatternScene } from "./pattern-events";
export type { PatternScene } from "./pattern-events";

/** 直接复用正式对话投影与正文阅读器；只有固定输入和本地回答不同。 */
export function PatternPreview({ scene }: { scene: PatternScene }) {
  const [answered, setAnswered] = useState(false);
  const events = useMemo(
    () => patternEvents(scene, answered),
    [scene, answered],
  );
  const waiting = scene === "confirmation" && !answered;
  return (
    <div className="explorer-pattern">
      <ConversationViewport>
        <div className="pattern-content">
          <p className="explorer-caption">
            固定事件演示 · 与 Desktop 共用 EventTimeline
          </p>
          <EventTimeline
            events={events}
            compact
            displayTime={Date.UTC(2026, 0, 1, 10, 24, 4)}
            active={scene !== "completed"}
            pendingInteraction={
              waiting
                ? {
                    turnId: "preview:t1",
                    effectId: "ask",
                    content: (
                      <InteractionCard
                        title="需要你的确认"
                        actions={
                          <Button variant="default" onClick={() => setAnswered(true)}>
                            继续核对
                          </Button>
                        }
                      >
                        历史记录不完整，是否继续核对已加载内容？
                      </InteractionCard>
                    ),
                  }
                : undefined
            }
          />
        </div>
      </ConversationViewport>
      <div className="ai-composer">
        <CurrentPlan events={events} turnId="preview:t1" />
        <Textarea aria-label="演示输入" placeholder="演示不发送任务" disabled />
      </div>
    </div>
  );
}
