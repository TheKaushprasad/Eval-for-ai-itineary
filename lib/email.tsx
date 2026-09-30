import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from "@react-email/components";
import { Resend } from "resend";
import { formatMoney } from "./budget";
import type { ItineraryResult } from "./schema";

const h2 = { fontSize: "18px", margin: "24px 0 8px", color: "#0f172a" };
const muted = { color: "#64748b", fontSize: "13px", margin: "2px 0" };
const p = { fontSize: "14px", lineHeight: "22px", margin: "4px 0", color: "#1e293b" };

export function ItineraryEmail({ result }: { result: ItineraryResult }) {
  const it = result.itinerary;
  const money = (n: number) => formatMoney(n, it.currency);
  return (
    <Html>
      <Head />
      <Preview>{it.summary.slice(0, 140)}</Preview>
      <Body style={{ backgroundColor: "#f1f5f9", fontFamily: "Helvetica, Arial, sans-serif" }}>
        <Container style={{ backgroundColor: "#ffffff", padding: "32px", maxWidth: "640px", borderRadius: "12px" }}>
          <Heading style={{ fontSize: "24px", color: "#0f172a" }}>{it.title}</Heading>
          <Text style={p}>{it.summary}</Text>
          <Text style={{ ...p, fontWeight: 600 }}>
            Estimated total: {money(result.computedTotal)} (budget {money(result.budgetLimit)}){" "}
            {result.withinBudget ? "✓ within budget" : "⚠ over budget"}
          </Text>

          <Heading as="h2" style={h2}>Getting there</Heading>
          <Text style={p}>Outbound: {it.transport.outbound.description} — {money(it.transport.outbound.cost)}</Text>
          <Text style={p}>Return: {it.transport.return.description} — {money(it.transport.return.cost)}</Text>
          <Text style={p}>Around town: {it.transport.local}</Text>

          <Heading as="h2" style={h2}>Where you&apos;ll stay</Heading>
          <Text style={p}>
            {it.accommodation.name}, {it.accommodation.area}. {it.accommodation.nights} nights ×{" "}
            {money(it.accommodation.nightlyRate)} = {money(it.accommodation.total)}
          </Text>
          <Text style={muted}>{it.accommodation.why}</Text>

          {it.days.map((d) => (
            <Section key={d.day}>
              <Hr />
              <Heading as="h2" style={h2}>Day {d.day} · {d.date} — {d.theme}</Heading>
              <Text style={muted}>{d.weather}</Text>
              {d.activities.map((a, i) => (
                <Text key={i} style={p}>
                  <b>{a.time}</b> {a.name} — {a.description} ({a.cost ? money(a.cost) : "free"})
                </Text>
              ))}
              {d.meals.map((m, i) => (
                <Text key={`m${i}`} style={muted}>
                  🍽 {m.meal}: {m.place} ({m.cuisine}) — {money(m.cost)}
                </Text>
              ))}
              {d.notes && <Text style={muted}>{d.notes}</Text>}
            </Section>
          ))}

          <Hr />
          <Heading as="h2" style={h2}>Budget</Heading>
          {Object.entries(it.budget).map(([k, v]) => (
            <Text key={k} style={p}>{k}: {money(v)}</Text>
          ))}

          {it.tips.length > 0 && (
            <>
              <Heading as="h2" style={h2}>Tips</Heading>
              {it.tips.map((t, i) => <Text key={i} style={p}>• {t}</Text>)}
            </>
          )}
          {it.sources.length > 0 && (
            <>
              <Heading as="h2" style={h2}>Sources</Heading>
              {it.sources.map((s, i) => (
                <Text key={i} style={muted}><Link href={s.url}>{s.title}</Link></Text>
              ))}
            </>
          )}
        </Container>
      </Body>
    </Html>
  );
}

export async function sendItineraryEmail(to: string, result: ItineraryResult) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.EMAIL_FROM || "Trip Planner <onboarding@resend.dev>",
    to,
    subject: `Your itinerary: ${result.itinerary.title}`,
    react: <ItineraryEmail result={result} />,
  });
  if (error) throw new Error(error.message);
}
