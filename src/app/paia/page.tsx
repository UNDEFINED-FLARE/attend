import Link from "next/link";
import { CompanyMark } from "@/components/company-mark";
import { LEGAL, show, SUB_OPERATORS } from "@/lib/legal";

export const metadata = { title: "PAIA manual" };

// Manual required of every private body by section 51 of the Promotion of Access to
// Information Act 2 of 2000 (as amended by POPIA). Company details come from
// src/lib/legal.ts. Have an attorney check it before publishing; not legal advice.
const H2 = ({ children }: { children: React.ReactNode }) => <h2 className="mt-10 text-lg font-semibold">{children}</h2>;

export default function Paia() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10 text-[15px] leading-relaxed">
      <Link href="/" className="text-sm text-info underline underline-offset-2 hover:decoration-2">← UniAttend</Link>
      <h1 className="mt-4 text-3xl font-semibold">PAIA manual</h1>
      <p className="mt-2 text-muted">Prepared under section 51 of the Promotion of Access to Information Act 2 of 2000 (PAIA). Last updated {LEGAL.paiaUpdated}.</p>

      <H2>1. About us</H2>
      <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-[14rem_1fr]">
        <dt className="text-muted">Company</dt><dd>{show(LEGAL.company)}</dd>
        <dt className="text-muted">Registration number</dt><dd>{show(LEGAL.registration)}</dd>
        <dt className="text-muted">Head of the company</dt><dd>{show(LEGAL.head)}</dd>
        <dt className="text-muted">Information Officer</dt><dd>{show(LEGAL.informationOfficer)}</dd>
        <dt className="text-muted">Email for requests</dt><dd>{show(LEGAL.privacyEmail)}</dd>
        <dt className="text-muted">Telephone</dt><dd>{show(LEGAL.phone)}</dd>
        <dt className="text-muted">Address</dt><dd>{show(LEGAL.address)}</dd>
      </dl>
      <p className="mt-3">We provide UniAttend, a service that records class attendance for universities and colleges.</p>

      <H2>2. The Information Regulator&apos;s guide</H2>
      <p className="mt-2">The Information Regulator publishes a guide on how to use PAIA and POPIA, in all official languages, at{" "}
        <a href="https://inforegulator.org.za" className="text-info underline" rel="noopener noreferrer">inforegulator.org.za</a>. You can also ask
        the Regulator for a copy.</p>

      <H2>3. Records available without a request</H2>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li>Our <Link href="/privacy" className="text-info underline">privacy notice</Link>, <Link href="/terms" className="text-info underline">terms of service</Link> and this manual.</li>
        <li>Product information on our website.</li>
        <li>Your own information held in UniAttend: download it any time from Security → <i>Download my data</i>.</li>
      </ul>

      <H2>4. Records kept because a law requires it</H2>
      <p className="mt-2">Including, where they apply: the Companies Act 71 of 2008; Income Tax Act 58 of 1962; Value-Added Tax Act 89 of 1991;
        Basic Conditions of Employment Act 75 of 1997; Labour Relations Act 66 of 1995; Employment Equity Act 55 of 1998;
        Unemployment Insurance Act 63 of 2001; Compensation for Occupational Injuries and Diseases Act 130 of 1993;
        Electronic Communications and Transactions Act 25 of 2002; Protection of Personal Information Act 4 of 2013.</p>

      <H2>5. Records we hold</H2>
      <ul className="mt-2 list-disc space-y-1 pl-6">
        <li><b>Company:</b> registration documents, minutes, shareholder records.</li>
        <li><b>Finance:</b> accounts, invoices, tax and banking records.</li>
        <li><b>Staff:</b> employment contracts, payroll, leave and training records.</li>
        <li><b>Customers (institutions):</b> agreements, contacts, invoices and correspondence.</li>
        <li><b>Suppliers:</b> agreements and correspondence.</li>
        <li><b>The UniAttend service:</b> account, attendance and related records that we hold <i>on behalf of</i> institutions.
          The institution is the responsible party for these, so a request for them is best made to the institution itself;
          we will pass on any we receive.</li>
        <li><b>Technical:</b> security and audit logs.</li>
      </ul>

      <H2>6. How we process personal information (POPIA)</H2>
      <ul className="mt-2 list-disc space-y-2 pl-6">
        <li><b>Purposes:</b> providing UniAttend to institutions; running the company (staff, customers, suppliers); meeting legal duties.</li>
        <li><b>People and information:</b> students and staff of institutions (names, emails, student or staff numbers, modules,
          attendance and check-in evidence, as set out in the privacy notice); our staff (employment records); contacts at
          customers and suppliers (names, work contact details).</li>
        <li><b>Who receives it:</b> the institution concerned; our service providers ({SUB_OPERATORS.map((s) => s.name).join("; ")});
          authorities where the law requires.</li>
        <li><b>Outside South Africa:</b> service records are stored in {LEGAL.hostingRegion}, which has data-protection law
          substantially similar to POPIA.</li>
        <li><b>Security:</b> encrypted connections; records of each institution separated in the database; access by role;
          audit logs of changes; staff confidentiality; a breach-response procedure.</li>
      </ul>

      <H2>7. How to request a record</H2>
      <ol className="mt-2 list-decimal space-y-2 pl-6">
        <li>Complete <b>Form 2</b> (Request for Access to Record) from the PAIA Regulations, available on the Information
          Regulator&apos;s website, and email it to the Information Officer above.</li>
        <li>Say which record you want, how you want access (copy, inspection, electronic), and, if you act for someone else, attach
          proof of your authority. If you want the record to exercise or protect a right, say which.</li>
        <li>We may ask for the prescribed request fee before processing, and an access fee before releasing the record, at the
          rates in the PAIA Regulations. <b>No fee is charged for your own personal information.</b></li>
        <li>We will answer within 30 days, or tell you if we need to extend that (by up to 30 days) and why.</li>
      </ol>

      <H2>8. When a request may be refused</H2>
      <p className="mt-2">As PAIA allows, for example to protect another person&apos;s privacy, commercial or confidential
        information of us or third parties, the safety of people or property, or legally privileged records. We will give
        reasons, and release any part of a record that can be separated.</p>

      <H2>9. If you disagree</H2>
      <p className="mt-2">You may complain to the Information Regulator within 180 days of our decision, or apply to court.</p>

      <H2>10. Where this manual is available</H2>
      <p className="mt-2">On this website and, on request, at our address above.</p>
      <CompanyMark className="mt-12 border-t border-line pt-4" />
    </main>
  );
}
