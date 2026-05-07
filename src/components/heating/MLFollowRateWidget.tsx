import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, TrendingUp, TrendingDown } from "lucide-react";

interface FollowRateRow {
  day: string;
  total_with_ml: number;
  followed: number;
  overridden: number;
  reward_when_followed: number | null;
  reward_when_overridden: number | null;
}

export function MLFollowRateWidget() {
  const [rows, setRows] = useState<FollowRateRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error } = await supabase.rpc("get_ml_follow_rate", { days_back: 7 });
      if (cancelled) return;
      if (!error && data) {
        setRows(
          (data as FollowRateRow[]).map((r) => ({
            ...r,
            total_with_ml: Number(r.total_with_ml),
            followed: Number(r.followed),
            overridden: Number(r.overridden),
            reward_when_followed: r.reward_when_followed != null ? Number(r.reward_when_followed) : null,
            reward_when_overridden: r.reward_when_overridden != null ? Number(r.reward_when_overridden) : null,
          })),
        );
      }
      setLoading(false);
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const totals = rows.reduce(
    (acc, r) => ({
      total: acc.total + r.total_with_ml,
      followed: acc.followed + r.followed,
      overridden: acc.overridden + r.overridden,
    }),
    { total: 0, followed: 0, overridden: 0 },
  );
  const followRate = totals.total > 0 ? (totals.followed / totals.total) * 100 : 0;

  const avgRewardFollowed = avg(rows.map((r) => r.reward_when_followed).filter((v): v is number => v != null));
  const avgRewardOverridden = avg(rows.map((r) => r.reward_when_overridden).filter((v): v is number => v != null));

  const maxBar = Math.max(1, ...rows.map((r) => r.total_with_ml));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          ML-Follow-Rate (7 Tage)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Lade…</p>
        ) : totals.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Noch keine ML-getrackten Entscheidungen. Tracking startet mit dem nächsten Heartbeat.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold">{followRate.toFixed(0)}%</span>
              <span className="text-xs text-muted-foreground">
                {totals.followed} von {totals.total} Entscheidungen folgten der ML-Empfehlung
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-md border p-2">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <TrendingUp className="h-3 w-3" />
                  <span>Reward wenn gefolgt</span>
                </div>
                <div className="font-medium">{avgRewardFollowed != null ? avgRewardFollowed.toFixed(2) : "—"}</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <TrendingDown className="h-3 w-3" />
                  <span>Reward wenn überstimmt</span>
                </div>
                <div className="font-medium">
                  {avgRewardOverridden != null ? avgRewardOverridden.toFixed(2) : "—"}
                </div>
              </div>
            </div>

            <div className="space-y-1">
              {rows.map((r) => (
                <div key={r.day} className="flex items-center gap-2 text-xs">
                  <span className="w-16 text-muted-foreground tabular-nums">
                    {new Date(r.day).toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" })}
                  </span>
                  <div className="flex-1 h-3 bg-muted rounded-sm overflow-hidden flex">
                    <div
                      className="bg-primary h-full"
                      style={{ width: `${(r.followed / maxBar) * 100}%` }}
                      title={`${r.followed} gefolgt`}
                    />
                    <div
                      className="bg-destructive/60 h-full"
                      style={{ width: `${(r.overridden / maxBar) * 100}%` }}
                      title={`${r.overridden} überstimmt`}
                    />
                  </div>
                  <span className="w-16 text-right tabular-nums">
                    {r.followed}/{r.overridden}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
