import type { Report, ReportSection } from "../describe";

export function ReportView({ report }: { report: Report }) {
  return (
    <article className="report" data-testid="report">
      <nav className="toc" aria-label="Sections">
        {report.sections.map((s) => <a key={s.id} href={`#sec-${s.id}`}>{s.title}</a>)}
      </nav>
      <div className="report-body">
        <header className="report-header">
          <h1>{report.title}</h1>
          <p className="subtitle">{report.subtitle}</p>
          <p className="muted">{report.wordCount.toLocaleString()} words · generated locally</p>
        </header>
        {report.sections.map((s) => <Section key={s.id} section={s} />)}
      </div>
    </article>
  );
}

function Section({ section: s }: { section: ReportSection }) {
  return (
    <section id={`sec-${s.id}`} className="report-section">
      <h2>{s.title}</h2>
      {s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      {s.bullets && <ul>{s.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
      {s.facts && (
        <dl className="facts">
          {s.facts.map((f) => (
            <div className="fact" key={f.label}><dt>{f.label}</dt><dd>{f.value}{f.note && <small> {f.note}</small>}</dd></div>
          ))}
        </dl>
      )}
      {s.table && (
        <div className="table-wrap">
          <table>
            <thead><tr>{s.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{s.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
