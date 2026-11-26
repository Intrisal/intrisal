import type { Metadata } from "next";
import { LegalPageShell } from "@/components/landing/LegalPageShell";

export const metadata: Metadata = {
  title: "Privacy Policy · Intrisal",
  description: "How Intrisal collects, uses, and protects personal information.",
};

export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Policy" updated="November 26, 2026">
      <p>
        This Privacy Policy explains how Intrisal (“Intrisal,” “we,” “us,” or “our”) collects, uses,
        discloses, and protects information when you visit{" "}
        <a href="https://www.intrisal.com">www.intrisal.com</a>, create an account, sign in, or use
        our stock research and analysis tools (collectively, the “Service”).
      </p>
      <p>
        By using the Service, you agree to this Policy. If you do not agree, do not use the Service.
      </p>

      <h2>1. Who we are</h2>
      <p>
        Intrisal provides informational tools that help users explore market data, company
        fundamentals, valuation context, and related research signals. Intrisal is not a broker,
        dealer, investment adviser, or fiduciary.
      </p>
      <p>
        Contact for privacy questions:{" "}
        <a href="mailto:contact@intrisal.com">contact@intrisal.com</a>.
      </p>

      <h2>2. Information we collect</h2>
      <h3>2.1 Account information</h3>
      <p>Depending on how you register, we may collect:</p>
      <ul>
        <li>Name</li>
        <li>Email address</li>
        <li>Password (stored only as a one-way cryptographic hash; we never store plaintext passwords)</li>
        <li>
          Optional marketing attribution (“How did you hear about us?” and any free-text detail you
          provide)
        </li>
        <li>
          Google account identifiers if you choose “Continue with Google” (such as your Google user
          ID, verified email, and display name provided by Google)
        </li>
      </ul>

      <h3>2.2 Usage and technical data</h3>
      <p>We may automatically collect:</p>
      <ul>
        <li>IP address, approximate location derived from IP, browser type, and device information</li>
        <li>Pages viewed, features used, referral URLs, and timestamps</li>
        <li>Diagnostic logs needed to operate, secure, and improve the Service</li>
      </ul>

      <h3>2.3 Market and product data</h3>
      <p>
        When you use the platform, we process tickers and research queries you submit, and we may
        retrieve market and company data from third-party providers (for example, market data and
        public regulatory filings sources). That product activity may be associated with your
        account for service delivery, caching, rate limiting, and abuse prevention.
      </p>

      <h2>3. How we use information</h2>
      <p>We use information to:</p>
      <ul>
        <li>Create and authenticate accounts, including Google sign-in</li>
        <li>Provide, maintain, personalize, and improve the Service</li>
        <li>Secure the Service, prevent fraud and abuse, and enforce our Terms</li>
        <li>Communicate about the Service, security notices, and material policy changes</li>
        <li>Understand product usage and improve reliability and performance</li>
        <li>Comply with law and respond to lawful requests</li>
      </ul>
      <p>We do not sell your personal information.</p>

      <h2>4. Cookies and session technology</h2>
      <p>
        We use essential cookies and similar technologies to keep you signed in (for example, a
        signed session cookie) and to protect account security during sign-in flows such as Google
        OAuth. These are required for core authentication. Disabling them may prevent sign-in.
      </p>

      <h2>5. How we share information</h2>
      <p>We may share information with:</p>
      <ul>
        <li>
          <strong>Service providers</strong> that host infrastructure, databases, email, analytics,
          or security tooling under contractual confidentiality and purpose limits
        </li>
        <li>
          <strong>Identity providers</strong> such as Google when you choose Google sign-in
          (subject to Google’s terms and privacy policy)
        </li>
        <li>
          <strong>Data and market providers</strong> as needed to fulfill your requests within the
          Service
        </li>
        <li>
          <strong>Authorities or counterparties</strong> when required by law, legal process, or to
          protect rights, safety, and the integrity of the Service
        </li>
        <li>
          <strong>Successors</strong> in connection with a merger, acquisition, financing, or sale
          of assets, subject to appropriate confidentiality protections
        </li>
      </ul>

      <h2>6. Retention</h2>
      <p>
        We retain account and related records for as long as your account remains active and as
        needed to provide the Service, resolve disputes, enforce agreements, and meet legal,
        tax, and security requirements. You may request account deletion by contacting{" "}
        <a href="mailto:contact@intrisal.com">contact@intrisal.com</a>. We may retain limited
        residual records where legally required or for legitimate security and audit purposes.
      </p>

      <h2>7. Security</h2>
      <p>
        We use administrative, technical, and organizational measures designed to protect personal
        information, including hashed passwords, encrypted transport where supported, access
        controls, and session integrity checks. No method of transmission or storage is completely
        secure; you use the Service at your own risk.
      </p>

      <h2>8. Children’s privacy</h2>
      <p>
        The Service is not directed to children under 13 (or the minimum age required in your
        jurisdiction). We do not knowingly collect personal information from children. If you
        believe a child has provided information, contact us and we will take appropriate steps to
        delete it.
      </p>

      <h2>9. International users</h2>
      <p>
        We may process information in the United States and other countries where we or our
        providers operate. Those locations may have different data-protection laws than your home
        country. By using the Service, you acknowledge that cross-border processing may occur as
        described in this Policy.
      </p>

      <h2>10. Your choices</h2>
      <ul>
        <li>Update account details where the product allows, or by contacting us</li>
        <li>Sign out to end an active session on that browser</li>
        <li>Disconnect Google access through your Google account permissions settings</li>
        <li>Request access, correction, or deletion where applicable law provides those rights</li>
      </ul>
      <p>
        Depending on your location, you may have additional rights (for example under GDPR or
        CCPA/CPRA). To exercise them, email{" "}
        <a href="mailto:contact@intrisal.com">contact@intrisal.com</a>. We may need to verify your
        identity before fulfilling a request.
      </p>

      <h2>11. Third-party links and data</h2>
      <p>
        The Service may reference third-party sites, APIs, or filings. Their privacy practices are
        governed by their own policies. Intrisal is not responsible for third-party content or
        practices.
      </p>

      <h2>12. Changes</h2>
      <p>
        We may update this Policy from time to time. The “Last updated” date will change when we
        do. Material changes may be highlighted in the Service or by email where appropriate.
        Continued use after an update constitutes acceptance of the revised Policy.
      </p>

      <h2>13. Contact</h2>
      <p>
        Intrisal Privacy
        <br />
        Email: <a href="mailto:contact@intrisal.com">contact@intrisal.com</a>
        <br />
        Web: <a href="https://www.intrisal.com">www.intrisal.com</a>
      </p>
    </LegalPageShell>
  );
}
