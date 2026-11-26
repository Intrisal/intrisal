import type { Metadata } from "next";
import { LegalPageShell } from "@/components/landing/LegalPageShell";

export const metadata: Metadata = {
  title: "Terms of Service · Intrisal",
  description: "Terms governing use of the Intrisal website and research platform.",
};

export default function TermsPage() {
  return (
    <LegalPageShell title="Terms of Service" updated="November 26, 2026">
      <p>
        These Terms of Service (“Terms”) govern your access to and use of Intrisal’s website,
        applications, and research tools available at{" "}
        <a href="https://www.intrisal.com">www.intrisal.com</a> (the “Service”). By creating an
        account, signing in, or using the Service, you agree to these Terms and our{" "}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <p>If you do not agree, do not use the Service.</p>

      <h2>1. The Service</h2>
      <p>
        Intrisal provides informational software for exploring securities-related data such as
        price history, fundamentals, valuation context, and related research signals. Features may
        change, and some landing-page demos use sample or illustrative data.
      </p>

      <h2>2. Not investment advice</h2>
      <p>
        <strong>
          Intrisal is for informational and educational purposes only. Nothing on the Service is
          investment advice, a recommendation, an offer, or a solicitation to buy or sell any
          security, strategy, or product.
        </strong>
      </p>
      <p>
        We do not provide tax, legal, or accounting advice. Markets involve risk, including loss of
        principal. Past performance is not indicative of future results. You are solely responsible
        for your investment decisions. Before acting, consult a qualified professional and do your
        own due diligence.
      </p>
      <p>
        Intrisal is not a registered investment adviser, broker-dealer, exchange, clearing house,
        or fiduciary. No client–adviser relationship is created by your use of the Service.
      </p>

      <h2>3. Eligibility and accounts</h2>
      <p>
        You must be legally able to enter a binding contract in your jurisdiction and meet any
        minimum age required by law (and in any event at least 13). You agree to provide accurate
        registration information and to keep it updated.
      </p>
      <p>
        You may create an account with email and password or through Google sign-in. An email
        address may be associated with only one account method. If an email is registered via
        Google, you may not create a separate password account with that same email, and vice
        versa, except as we expressly allow.
      </p>
      <p>
        You are responsible for safeguarding your credentials and for activity under your account.
        Notify us promptly at <a href="mailto:contact@intrisal.com">contact@intrisal.com</a> if you
        suspect unauthorized access. We may suspend or terminate accounts to protect the Service or
        other users.
      </p>

      <h2>4. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service for unlawful, deceptive, or harmful purposes</li>
        <li>Attempt to bypass authentication, rate limits, or security controls</li>
        <li>Scrape, harvest, or bulk-export data except as the product interface expressly allows</li>
        <li>Reverse engineer, interfere with, or disrupt the Service or its infrastructure</li>
        <li>Misrepresent your identity or affiliation</li>
        <li>Use the Service to provide regulated investment advice to others without required licenses</li>
        <li>Upload malware or engage in abusive automated traffic</li>
      </ul>
      <p>
        We may investigate violations and take action including suspension, termination, and
        reporting to authorities where appropriate.
      </p>

      <h2>5. Data sources and accuracy</h2>
      <p>
        Market prices, fundamentals, filings-derived metrics, and other figures may come from
        third-party providers, public sources, or derived calculations. Data may be delayed,
        incomplete, estimated, restated, or incorrect. We do not warrant that any figure, signal,
        chart, or ranking is accurate, complete, current, or suitable for any purpose.
      </p>
      <p>
        You should verify material information independently, including from primary filings and
        official market sources, before making decisions.
      </p>

      <h2>6. Intellectual property</h2>
      <p>
        The Service, including software, design, branding, text, and original compilations, is owned
        by Intrisal or its licensors and is protected by intellectual property laws. We grant you a
        limited, revocable, non-exclusive, non-transferable license to use the Service for your
        personal or internal business research, subject to these Terms.
      </p>
      <p>
        You may not copy, modify, distribute, sell, or create derivative works from the Service
        except as expressly permitted in writing.
      </p>

      <h2>7. Third-party services</h2>
      <p>
        The Service may integrate third parties (for example Google authentication or market-data
        vendors). Your use of those services may be subject to their terms. Intrisal is not
        responsible for third-party services outside our reasonable control.
      </p>

      <h2>8. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED “AS IS” AND “AS AVAILABLE.” TO THE MAXIMUM EXTENT PERMITTED BY LAW,
        INTRISAL DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS
        FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. WE DO NOT WARRANT UNINTERRUPTED OR
        ERROR-FREE OPERATION, OR THAT DEFECTS WILL BE CORRECTED.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, INTRISAL AND ITS AFFILIATES, OFFICERS, EMPLOYEES,
        AND PROVIDERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
        EXEMPLARY, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, DATA, GOODWILL, OR TRADING LOSSES,
        ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE, EVEN IF ADVISED OF THE POSSIBILITY.
      </p>
      <p>
        OUR TOTAL LIABILITY FOR ANY CLAIM ARISING OUT OF THESE TERMS OR THE SERVICE WILL NOT EXCEED
        THE GREATER OF (A) THE AMOUNTS YOU PAID TO INTRISAL FOR THE SERVICE IN THE TWELVE (12)
        MONTHS BEFORE THE CLAIM OR (B) ONE HUNDRED U.S. DOLLARS (US $100), IF YOU HAVE NOT PAID.
      </p>
      <p>
        Some jurisdictions do not allow certain limitations; in those cases, our liability is
        limited to the fullest extent permitted.
      </p>

      <h2>10. Indemnity</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Intrisal and its affiliates, officers,
        and employees from claims, damages, losses, and expenses (including reasonable attorneys’
        fees) arising out of your use of the Service, your content or decisions, or your violation
        of these Terms or applicable law.
      </p>

      <h2>11. Suspension and termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate access immediately
        if you breach these Terms, if required by law, or if needed to protect the Service or
        others. Provisions that by nature should survive (including ownership, disclaimers,
        limitations, and indemnity) will survive termination.
      </p>

      <h2>12. Changes to the Service or Terms</h2>
      <p>
        We may modify or discontinue features at any time. We may update these Terms by posting a
        revised version with an updated date. Continued use after changes become effective
        constitutes acceptance. If you do not agree, stop using the Service.
      </p>

      <h2>13. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, excluding conflict-of-law
        rules, unless mandatory consumer protections in your place of residence provide otherwise.
        Exclusive venue for disputes that are not subject to a mandatory contrary rule will be the
        state or federal courts located in Delaware, and you consent to personal jurisdiction
        there.
      </p>

      <h2>14. Miscellaneous</h2>
      <p>
        These Terms and the Privacy Policy are the entire agreement between you and Intrisal
        regarding the Service. If any provision is unenforceable, the remainder stays in effect.
        Failure to enforce a provision is not a waiver. You may not assign these Terms without our
        consent; we may assign them in connection with a corporate transaction. Headings are for
        convenience only.
      </p>

      <h2>15. Contact</h2>
      <p>
        Intrisal
        <br />
        Email: <a href="mailto:contact@intrisal.com">contact@intrisal.com</a>
        <br />
        Web: <a href="https://www.intrisal.com">www.intrisal.com</a>
      </p>
    </LegalPageShell>
  );
}
