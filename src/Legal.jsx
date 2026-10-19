// Rechtsseiten (Impressum + Datenschutzerklärung) als SPA-Routen.
// Aufruf: /impressum und /datenschutz (siehe router.js, main.jsx und vercel.json).
// Beide Seiten sind bewusst auch OHNE Anmeldung erreichbar (Pflichtseiten).
//
// Das Layout folgt dem dunklen Theme der App (Tailwind, cyan/slate).
import React from 'react';
import { BRAND_NAME, Disclaimer, LegalLinks } from './brand';
import { navigate } from './router';

const CONTACT_MAIL = 'poketracker0203@gmail.com';

const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h2 className="text-base font-black text-cyan-300">{title}</h2>
    <div className="space-y-2 text-sm text-slate-300 leading-relaxed">{children}</div>
  </section>
);

const P = ({ children }) => <p>{children}</p>;

const Strong = ({ children }) => <strong className="text-slate-100">{children}</strong>;

const Code = ({ children }) => <code className="text-cyan-300 break-all">{children}</code>;

const Mail = () => (
  <a className="text-cyan-400 underline underline-offset-2 break-all" href={`mailto:${CONTACT_MAIL}`}>
    {CONTACT_MAIL}
  </a>
);

export function LegalShell({ title, children }) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-30 bg-slate-900/90 backdrop-blur-md border-b border-cyan-500/20 px-4 py-3 flex items-center justify-between">
        <span className="text-cyan-400 text-lg font-black tracking-wider">{title}</span>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="text-xs bg-slate-800 px-3 py-1.5 rounded-lg text-slate-300 hover:text-cyan-400 transition-colors"
        >
          ← Zurück zur App
        </button>
      </header>
      <main className="max-w-3xl mx-auto p-4 pb-16 space-y-6">
        {children}
        <footer className="pt-8 mt-8 border-t border-slate-800 space-y-3">
          <LegalLinks />
          <Disclaimer />
        </footer>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------
// Impressum
// ---------------------------------------------------------------------
export function ImpressumPage() {
  return (
    <LegalShell title="Impressum">
      <h1 className="text-2xl font-black text-white">Impressum</h1>

      <Section title="Angaben gemäß § 5 DDG">
        <P>Leon Mertz</P>
        <P>Nelkenweg 6</P>
        <P>40882 Ratingen</P>
        <P>Deutschland</P>
      </Section>

      <Section title="Kontakt">
        <P>Telefon: +49 170 9094830</P>
        <P>E-Mail: <Mail /></P>
      </Section>

      <Section title="Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV">
        <P>Leon Mertz, Anschrift wie oben.</P>
      </Section>

      <Section title="Verbraucherstreitbeilegung">
        <P>
          Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen (§ 36 VSBG).
        </P>
      </Section>

      <Section title="Haftung für Inhalte">
        <P>
          Als Diensteanbieter sind wir für eigene Inhalte auf diesen Seiten nach den allgemeinen
          Gesetzen verantwortlich. Wir sind jedoch nicht verpflichtet, übermittelte oder gespeicherte
          fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine
          rechtswidrige Tätigkeit hinweisen.
        </P>
      </Section>

      <Section title="Haftung für Links">
        <P>
          Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen
          Einfluss haben. Für diese fremden Inhalte kann keine Gewähr übernommen werden. Zum
          Zeitpunkt der Verlinkung waren keine rechtswidrigen Inhalte erkennbar. Bei Bekanntwerden
          von Rechtsverletzungen werden entsprechende Links umgehend entfernt.
        </P>
      </Section>

      <Section title="Urheberrecht">
        <P>
          Die durch uns erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen
          Urheberrecht. Beiträge Dritter sind als solche gekennzeichnet. Vervielfältigung, Bearbeitung,
          Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechts bedürfen
          unserer schriftlichen Zustimmung. Downloads und Kopien dieser Seite sind nur für den
          privaten, nicht kommerziellen Gebrauch gestattet.
        </P>
      </Section>

      <Section title="Marken- und Fan-Hinweis">
        <P>
          {BRAND_NAME} ist ein inoffizielles Fan-Projekt. Es besteht keine Verbindung zu The Pokémon
          Company, Nintendo oder Creatures Inc. Alle genannten Marken, Logos und Produktnamen sind
          Eigentum ihrer jeweiligen Inhaber und dienen nur der Kennzeichnung.
        </P>
      </Section>
    </LegalShell>
  );
}

// ---------------------------------------------------------------------
// Datenschutzerklärung
// ---------------------------------------------------------------------
export function DatenschutzPage() {
  return (
    <LegalShell title="Datenschutz">
      <h1 className="text-2xl font-black text-white">Datenschutzerklärung</h1>
      <p className="text-xs text-slate-500">Stand: Oktober 2026</p>

      <Section title="1. Verantwortlicher und Überblick">
        <P>
          Verantwortlich für die Datenverarbeitung in dieser App ist Leon Mertz, Nelkenweg 6,
          40882 Ratingen, Telefon: +49 170 9094830, E-Mail: <Mail />.
        </P>
        <P>
          {BRAND_NAME} ist eine App zur Verwaltung, Bewertung und Analyse von Pokémon-Sammelkarten.
          Wir verarbeiten personenbezogene Daten nur, soweit dies für die Bereitstellung der App
          erforderlich ist. Es werden <Strong>keine Werbe- oder Analyse-Cookies</Strong> und
          <Strong> keine Tracking-Tools</Strong> eingesetzt.
        </P>
        <P>
          Welche Daten anfallen: Konto- und Anmeldedaten (E-Mail-Adresse, Passwort-Hash,
          Benutzer-ID), die von Ihnen erfassten Sammlungs- und Watchlist-Daten, Einstellungen,
          optional Fotos von Binderseiten sowie Bilder, die Sie zur Kartenerkennung hochladen.
          Technische Zugriffsdaten (z. B. IP-Adresse, Zeitpunkt des Aufrufs) fallen bei jedem
          Server-Aufruf an und werden zur Auslieferung und Absicherung des Dienstes verarbeitet.
        </P>
      </Section>

      <Section title="2. Hosting und Infrastruktur">
        <P>
          <Strong>Vercel</Strong> (Vercel Inc., 340 S Lemon Ave #4133, Walnut, CA 91789, USA) hostet
          die App-Oberfläche. Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (sichere, schnelle
          Bereitstellung). Die Übermittlung in die USA stützt sich auf das EU-US Data Privacy
          Framework (DPF) bzw. EU-Standardvertragsklauseln.
        </P>
        <P>
          <Strong>Render</Strong> (Render Services, Inc., 548 Market St, PMB 62453, San Francisco,
          CA 94104, USA) hostet die Backend-API (Kartendaten, Preisabruf, KI-Scan).
          Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO (funktionsfähige Server-Infrastruktur).
          Drittlandübermittlung wie oben.
        </P>
        <P>
          <Strong>Google Firebase</Strong> (Google Ireland Limited, Gordon House, Barrow Street,
          Dublin 4, Irland; Mutterkonzern Google LLC, USA) stellt Authentifizierung und Datenbank
          bereit. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung).
        </P>
        <P>
          <Strong>Ko-fi</Strong> (Ko-fi Labs Ltd., Vereinigtes Königreich): Der freiwillige
          Unterstützen-Link führt auf eine externe Seite. Daten (z. B. Zahlungsdaten) werden erst
          dort verarbeitet; es gilt die Datenschutzerklärung von Ko-fi. In der App selbst werden
          dafür keine personenbezogenen Daten an Ko-fi übertragen.
        </P>
      </Section>

      <Section title="3. Konto, Anmeldung und gespeicherte Daten">
        <P>
          <Strong>Anmeldung:</Strong> Sie können sich mit E-Mail-Adresse und Passwort oder über
          Google anmelden. Gespeichert werden Ihre E-Mail-Adresse, ein Passwort-Hash (bei reiner
          Google-Anmeldung nicht bei uns) und eine eindeutige Benutzer-ID (UID).
        </P>
        <P>
          <Strong>Firestore-Datenbank:</Strong> Sammlung, Watchlist, Verkaufs- und Wertverlaufsdaten,
          Binder, Binder-Fotos, Einstellungen und Push-Abonnements liegen unter Ihrer UID
          (<Code>users/&#123;uid&#125;/…</Code>) und sind durch Sicherheitsregeln auf Ihr Konto
          beschränkt. Freigabe-Links („Sammlung teilen“) enthalten eine zufällige ID und sind für
          jeden mit dem Link lesbar, bis Sie den Link löschen oder Ihr Konto löschen.
        </P>
        <P>
          <Strong>Push-Benachrichtigungen:</Strong> Wenn Sie Benachrichtigungen aktivieren, speichern
          wir Endpoint und Schlüssel Ihres Browsers, um Sie bei erreichtem Zielpreis zu informieren.
          Sie können das jederzeit in der App oder in den Browsereinstellungen beenden.
        </P>
        <P>
          Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung der App-Funktionen), für
          Push-Benachrichtigungen Ihre Einwilligung nach Art. 6 Abs. 1 lit. a DSGVO.
        </P>
      </Section>

      <Section title="4. KI-Kartenscans und Fair-Use-Limit">
        <P>
          Wenn Sie die Scan-Funktion nutzen, wird das von Ihnen aufgenommene Bild an unsere
          Backend-API und von dort an einen KI-Dienstleister zur Bilderkennung übermittelt. Zweck ist
          ausschließlich die Erkennung von Kartenname, Nummer, Set und Variante.
        </P>
        <P>
          <Strong>Speicherdauer der Bilder:</Strong> Bilder werden nur für den Analysevorgang
          verarbeitet und nicht dauerhaft gespeichert. Eine Nutzung zum Training von KI-Modellen
          erfolgt durch uns nicht.
        </P>
        <P>
          <Strong>Nutzungszähler:</Strong> Um Kosten und Missbrauch zu begrenzen, zählt der Server
          Ihre Scans pro Kalendermonat (UTC). Es gilt ein Limit von <Strong>25 KI-Scans pro Monat und
          Konto</Strong>; zusätzlich kann ein monatliches Gesamtbudget für alle Nutzer greifen.
          Gespeichert werden lediglich Zählerstand, Monat und UID – keine Bildinhalte. Schlägt die
          Analyse aus Servergründen fehl, wird der Scan zurückgebucht.
        </P>
        <P>
          Rechtsgrundlage: Art. 6 Abs. 1 lit. b und lit. f DSGVO (Bereitstellung der Scan-Funktion,
          Kostenschutz, Missbrauchsabwehr).
        </P>
      </Section>

      <Section title="5. Löschung des Kontos, Speicherdauer und Backups">
        <P>
          Sie können Ihr Konto jederzeit im Profil unter „Konto löschen“ entfernen. Zur Sicherheit
          verlangen wir eine erneute Anmeldung und die Bestätigung durch Eintippen von „LÖSCHEN“.
          Danach löscht der Server unverzüglich und unwiderruflich:
        </P>
        <P>
          1. alle Daten unter <Code>users/&#123;uid&#125;</Code> inklusive aller Unter-Sammlungen
          (Sammlung, Watchlist, Binder, Binder-Fotos, Push-Abos, Wertverlauf),<br />
          2. Ihre geteilten Links samt Inhalten,<br />
          3. den Scan-Zähler Ihres Kontos,<br />
          4. Ihre Firebase-Anmeldung (Auth-Konto). Ein danach im Browser verbleibender Anmelde-Token
          ist wertlos und wird von der App verworfen.
        </P>
        <P>
          Alternativ können Sie die Löschung per E-Mail an <Mail /> verlangen.
        </P>
        <P>
          <Strong>Aufbewahrung von Sicherungskopien:</Strong> Von der Datenbank können
          Sicherungskopien (Backups/Exporte) erstellt werden. Gelöschte Daten können darin noch
          enthalten sein, bis die Sicherung überschrieben wird; diese Frist halten wir bewusst kurz
          (aktuell <Strong>höchstens 30 Tage</Strong>). In diesem Zeitraum werden die Daten nicht
          aktiv genutzt und nicht wiederhergestellt, außer es besteht eine gesetzliche Pflicht.
          Server-Logs mit technischen Zugriffsdaten werden spätestens nach 30 Tagen gelöscht.
        </P>
        <P>
          Ohne Kontolöschung speichern wir Ihre Daten, bis der Zweck entfällt oder Sie die Löschung
          verlangen.
        </P>
      </Section>

      <Section title="6. Ihre Rechte, lokaler Speicher und Kontakt">
        <P>
          Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO), Löschung
          (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO), Datenübertragbarkeit
          (Art. 20 DSGVO) sowie Widerspruch gegen Verarbeitungen auf Grundlage berechtigter
          Interessen (Art. 21 DSGVO). Eine Einwilligung können Sie jederzeit mit Wirkung für die
          Zukunft widerrufen. Außerdem steht Ihnen ein Beschwerderecht bei einer
          Datenschutz-Aufsichtsbehörde zu – für uns zuständig ist die Landesbeauftragte für
          Datenschutz und Informationsfreiheit Nordrhein-Westfalen.
        </P>
        <P>
          <Strong>Lokaler Speicher (Local Storage):</Strong> Die App speichert funktionale Einträge
          im Browser (Anmeldesitzung von Firebase, zuletzt gewählter Kartenzustand/Sprache, Zeitpunkt
          des letzten Preisabrufs). Rechtsgrundlage ist § 25 Abs. 2 Nr. 2 TDDDG; ein
          Einwilligungsbanner ist dafür nicht erforderlich. Es werden keine Tracking- oder
          Analyse-Cookies gesetzt.
        </P>
        <P>
          <Strong>Kontaktaufnahme per E-Mail:</Strong> Ihre Anfrage inklusive der daraus
          hervorgehenden Daten wird zur Bearbeitung Ihres Anliegens gespeichert (Art. 6 Abs. 1 lit. b
          bzw. lit. f DSGVO) und gelöscht, sobald der Zweck entfällt und keine gesetzlichen
          Aufbewahrungsfristen entgegenstehen.
        </P>
        <P>
          <Strong>Sicherheit:</Strong> Die Übertragung erfolgt verschlüsselt (TLS/HTTPS). Zugriffe auf
          Ihre Daten sind durch Firebase-Sicherheitsregeln auf Ihr Konto beschränkt; serverseitige
          Schreibzugriffe auf den Scan-Zähler erfolgen ausschließlich über das Admin-SDK.
        </P>
      </Section>
    </LegalShell>
  );
}

