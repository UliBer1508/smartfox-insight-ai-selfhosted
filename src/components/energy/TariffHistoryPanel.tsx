import { useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useEnergyPrices } from "@/hooks/useEnergyPrices";
import { RefreshCw, Plus } from "lucide-react";
import { toast } from "sonner";

const SOURCE_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  manual: { label: "Manuell", variant: "outline" },
  initial: { label: "Initial", variant: "secondary" },
  salzburg_ag_auto: { label: "Salzburg AG", variant: "default" },
  oemag_auto: { label: "ÖMAG", variant: "default" },
};

export function TariffHistoryPanel() {
  const { history, suggestions, isChecking, checkNow, addManual, reload } =
    useEnergyPrices();
  const [showAdd, setShowAdd] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const latest = history[0];
  const [form, setForm] = useState({
    valid_from: today,
    electricity_price_cent: latest?.electricity_price_cent ?? 20.28,
    feed_in_price_cent: latest?.feed_in_price_cent ?? 8.0,
    electricity_base_fee_year_eur: latest?.electricity_base_fee_year_eur ?? 36.0,
    note: "",
  });

  const handleAdd = async () => {
    try {
      await addManual({
        valid_from: form.valid_from,
        electricity_price_cent: Number(form.electricity_price_cent),
        feed_in_price_cent: Number(form.feed_in_price_cent),
        electricity_base_fee_year_eur: Number(
          form.electricity_base_fee_year_eur,
        ),
        note: form.note || undefined,
      });
      toast.success("Neuer Preis eingetragen");
      setShowAdd(false);
    } catch (e) {
      toast.error(`Fehler: ${(e as Error).message}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-base">Tarife & Preisverlauf</CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await checkNow();
                toast.success("Preise geprüft");
              }}
              disabled={isChecking}
            >
              <RefreshCw
                className={`h-4 w-4 mr-1 ${isChecking ? "animate-spin" : ""}`}
              />
              Jetzt prüfen
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAdd((v) => !v)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Neuer Preis
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {showAdd && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-md border bg-muted/30">
            <div className="space-y-1">
              <Label className="text-xs">Gültig ab</Label>
              <Input
                type="date"
                value={form.valid_from}
                onChange={(e) =>
                  setForm({ ...form, valid_from: e.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Strompreis (ct/kWh)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.electricity_price_cent}
                onChange={(e) =>
                  setForm({
                    ...form,
                    electricity_price_cent: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Einspeise (ct/kWh)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.feed_in_price_cent}
                onChange={(e) =>
                  setForm({
                    ...form,
                    feed_in_price_cent: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Grundgebühr (€/Jahr)</Label>
              <Input
                type="number"
                step="0.01"
                value={form.electricity_base_fee_year_eur}
                onChange={(e) =>
                  setForm({
                    ...form,
                    electricity_base_fee_year_eur: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Notiz (optional)</Label>
              <Input
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                placeholder="z. B. Neuer Salzburg AG Tarif Klassik 2027"
              />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAdd(false)}
              >
                Abbrechen
              </Button>
              <Button size="sm" onClick={handleAdd}>
                Speichern
              </Button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gültigkeit</TableHead>
                <TableHead className="text-right">Strom</TableHead>
                <TableHead className="text-right">Einspeise</TableHead>
                <TableHead className="text-right">Grund/Jahr</TableHead>
                <TableHead>Quelle</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => {
                const badge = SOURCE_BADGE[h.source] ?? {
                  label: h.source,
                  variant: "outline" as const,
                };
                return (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs">
                      {new Date(h.valid_from).toLocaleDateString("de-AT")}
                      {" – "}
                      {h.valid_to
                        ? new Date(h.valid_to).toLocaleDateString("de-AT")
                        : "heute"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Number(h.electricity_price_cent).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Number(h.feed_in_price_cent).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {Number(h.electricity_base_fee_year_eur).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={badge.variant} className="text-xs">
                        {badge.label}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {history.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-sm text-muted-foreground"
                  >
                    Noch keine Preis-Historie vorhanden
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        {suggestions.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Letzte Vorschläge
            </div>
            <div className="space-y-1">
              {suggestions.slice(0, 5).map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-xs gap-2 p-2 rounded border bg-card"
                >
                  <span>
                    {s.source === "oemag" ? "ÖMAG" : "Salzburg AG"} ·{" "}
                    {s.field === "electricity_price_cent"
                      ? "Strom"
                      : s.field === "feed_in_price_cent"
                        ? "Einspeise"
                        : "Grund"}
                    : {Number(s.new_value).toFixed(2)} ·{" "}
                    {new Date(s.fetched_at).toLocaleDateString("de-AT")}
                  </span>
                  <Badge
                    variant={
                      s.status === "applied"
                        ? "default"
                        : s.status === "dismissed"
                          ? "outline"
                          : "secondary"
                    }
                    className="text-xs"
                  >
                    {s.status === "applied"
                      ? "Übernommen"
                      : s.status === "dismissed"
                        ? "Verworfen"
                        : "Offen"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
