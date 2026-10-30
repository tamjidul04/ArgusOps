import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const txId = searchParams.get("txId");
    const userId = searchParams.get("userId") || "usr_tamjid_master";

    let transaction = null;
    if (txId) {
      transaction = await prisma.transactionApprovalQueue.findUnique({
        where: { tx_id: txId },
        include: { user: true },
      });
    }

    if (!transaction) {
      transaction = await prisma.transactionApprovalQueue.findFirst({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        include: { user: true },
      });
    }

    const user =
      transaction?.user ||
      (await prisma.user.findUnique({
        where: { id: userId },
      }));

    const invoiceNumber = transaction
      ? `INV-${transaction.tx_id.slice(-8).toUpperCase()}`
      : `INV-${Date.now().toString().slice(-8)}`;

    const planName = transaction?.requested_plan || "ArgusOps Pro Swarm";
    const amount = transaction?.amount ?? 49.0;
    const status = transaction?.admin_status || "APPROVED";
    const invoiceDate = transaction?.created_at
      ? new Date(transaction.created_at).toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoiceNumber} - ArgusOps</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 40px;
      color: #0f172a;
      background: #f8fafc;
    }
    .invoice-card {
      max-width: 720px;
      margin: 0 auto;
      background: #ffffff;
      padding: 48px;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #f1f5f9;
      padding-bottom: 28px;
      margin-bottom: 32px;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-weight: 800;
      font-size: 22px;
      letter-spacing: -0.5px;
      color: #0f172a;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .status-APPROVED { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
    .status-PENDING { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
    .status-REJECTED { background: #fff1f2; color: #be123c; border: 1px solid #fecdd3; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-bottom: 36px;
    }
    .field-label {
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .field-value {
      font-size: 14px;
      color: #0f172a;
      line-height: 1.5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 32px;
    }
    th {
      text-align: left;
      padding: 12px 16px;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
      border-top: 1px solid #e2e8f0;
      border-bottom: 1px solid #e2e8f0;
    }
    td {
      padding: 16px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 14px;
    }
    .totals {
      margin-left: auto;
      width: 280px;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      font-size: 14px;
      color: #64748b;
    }
    .totals-row.grand {
      border-top: 2px solid #e2e8f0;
      margin-top: 8px;
      padding-top: 12px;
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
    }
    .footer {
      border-top: 1px solid #f1f5f9;
      padding-top: 24px;
      margin-top: 40px;
      font-size: 12px;
      color: #94a3b8;
      text-align: center;
    }
    @media print {
      body { background: #ffffff; padding: 0; }
      .invoice-card { border: none; box-shadow: none; padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="max-width: 720px; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 12px;">
    <button onclick="window.print()" style="cursor: pointer; background: #0f172a; color: white; border: none; padding: 8px 18px; border-radius: 6px; font-weight: 600; font-size: 13px;">
      🖨️ Print / Save as PDF
    </button>
  </div>
  <div class="invoice-card">
    <div class="header">
      <div>
        <div class="logo-badge">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 22 22 22 12 2"></polygon>
          </svg>
          ArgusOps
        </div>
        <p style="margin: 6px 0 0; font-size: 13px; color: #64748b;">Enterprise Multi-Agent Orchestration & Hypervisor</p>
      </div>
      <div style="text-align: right;">
        <span class="status-badge status-${status}">${status}</span>
        <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 8px;">${invoiceNumber}</div>
        <div style="font-size: 12px; color: #64748b;">Issued: ${invoiceDate}</div>
      </div>
    </div>

    <div class="grid">
      <div>
        <div class="field-label">Billed To</div>
        <div class="field-value" style="font-weight: 600;">${user?.name || "Enterprise Customer"}</div>
        <div class="field-value">${user?.email || "billing@customer.com"}</div>
        <div class="field-value" style="color: #64748b; font-size: 12px; margin-top: 4px;">User ID: ${user?.id || userId}</div>
      </div>
      <div>
        <div class="field-label">Billed By</div>
        <div class="field-value" style="font-weight: 600;">ArgusOps Technologies Inc.</div>
        <div class="field-value">548 Market St, Suite 89200</div>
        <div class="field-value">San Francisco, CA 94104</div>
        <div class="field-value" style="color: #64748b; font-size: 12px; margin-top: 4px;">support@argusops.dev</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align: center;">Billing Cycle</th>
          <th style="text-align: right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <div style="font-weight: 600; color: #0f172a;">${planName}</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
              Includes 24/7 AST loop circuit-breaker, hardware RAM governance, and local mutex lock coordinator
            </div>
          </td>
          <td style="text-align: center; color: #64748b;">Monthly</td>
          <td style="text-align: right; font-weight: 600; color: #0f172a;">$${amount.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row">
        <span>Subtotal</span>
        <span>$${amount.toFixed(2)}</span>
      </div>
      <div class="totals-row">
        <span>Estimated Tax (0%)</span>
        <span>$0.00</span>
      </div>
      <div class="totals-row grand">
        <span>Total Due / Paid</span>
        <span>$${amount.toFixed(2)} USD</span>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0;">This electronic receipt confirms your active billing record on the ArgusOps platform.</p>
      <p style="margin: 4px 0 0;">Questions? Contact billing@argusops.dev or visit your Admin Control Panel.</p>
    </div>
  </div>
</body>
</html>`;

    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    if ((error as any)?.digest?.startsWith("NEXT_")) {
      throw error;
    }
    console.error("Invoice generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate invoice" },
      { status: 500 }
    );
  }
}
