import { Document, Link, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { InvoiceDocumentData } from './invoice-data';

/** The invoice as an A4 PDF. Kept plain on purpose: one accent, generous space, tabular amounts. */

const INK = '#171714';
const MUTED = '#6b6b63';
const RULE = '#e4e4de';
const ACCENT = '#a3e635';

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, color: INK, fontFamily: 'Helvetica', lineHeight: 1.4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  mark: { width: 28, height: 28, borderRadius: 7, backgroundColor: ACCENT, marginBottom: 10 },
  issuer: { fontSize: 12, fontFamily: 'Helvetica-Bold' },
  title: {
    fontSize: 26,
    lineHeight: 1.1,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: -0.5,
    textAlign: 'right',
    marginBottom: 6,
  },
  number: { fontSize: 11, color: MUTED, textAlign: 'right', marginTop: 2 },
  status: { fontSize: 9, color: MUTED, textAlign: 'right', marginTop: 2, textTransform: 'uppercase' },
  meta: { flexDirection: 'row', marginTop: 36, gap: 36 },
  metaBlock: { flexDirection: 'column', gap: 2 },
  label: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 },
  strong: { fontFamily: 'Helvetica-Bold' },
  table: { marginTop: 36 },
  head: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 6 },
  row: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: RULE, paddingVertical: 8 },
  th: { fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  colDesc: { flexGrow: 1, flexBasis: 0, paddingRight: 12 },
  colQty: { width: 56, textAlign: 'right' },
  colPrice: { width: 84, textAlign: 'right' },
  colAmount: { width: 90, textAlign: 'right' },
  totals: { marginTop: 14, alignSelf: 'flex-end', width: 240 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  due: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: INK,
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
  },
  section: { marginTop: 32 },
  muted: { color: MUTED },
  small: { fontSize: 8.5, color: MUTED },
  summary: { marginTop: 28, fontSize: 13, fontFamily: 'Helvetica-Bold' },
  colTax: { width: 48, textAlign: 'right' },
  payRow: { flexDirection: 'row', paddingVertical: 4 },
  footer: { position: 'absolute', left: 48, right: 48, bottom: 32, fontSize: 8, color: MUTED, textAlign: 'center' },
});

export function InvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  const { billTo, totals } = data;

  return (
    <Document title={`Invoice ${data.number}`} author={data.issuedBy.name}>
      <Page size="A4" style={styles.page}>
        <View style={styles.top}>
          <View>
            <View style={styles.mark} />
            <Text style={styles.issuer}>{data.issuedBy.name}</Text>
            {data.issuedBy.address.map((line) => (
              <Text key={line} style={styles.small}>
                {line}
              </Text>
            ))}
            {data.issuedBy.taxId ? <Text style={styles.small}>Tax ID: {data.issuedBy.taxId}</Text> : null}
          </View>
          <View>
            <Text style={styles.title}>Invoice</Text>
            <Text style={styles.number}>{data.number}</Text>
            <Text style={styles.status}>{data.status}</Text>
          </View>
        </View>

        <View style={styles.meta}>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Billed to</Text>
            {billTo.company ? <Text style={styles.strong}>{billTo.company}</Text> : null}
            {billTo.contact ? <Text>{billTo.contact}</Text> : null}
            {!billTo.company && !billTo.contact ? <Text style={styles.muted}>-</Text> : null}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Issued</Text>
            <Text>{data.issue_date ?? '-'}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Due</Text>
            <Text>{data.due_date ?? 'On receipt'}</Text>
          </View>
        </View>

        <Text style={styles.summary}>{data.summary}</Text>

        <View style={styles.table}>
          <View style={styles.head}>
            <Text style={[styles.th, styles.colDesc]}>Description</Text>
            <Text style={[styles.th, styles.colQty]}>Qty</Text>
            <Text style={[styles.th, styles.colPrice]}>Unit price</Text>
            <Text style={[styles.th, styles.colTax]}>Tax</Text>
            <Text style={[styles.th, styles.colAmount]}>Amount</Text>
          </View>
          {data.lines.length === 0 ? (
            <View style={styles.row}>
              <Text style={styles.muted}>No items.</Text>
            </View>
          ) : (
            data.lines.map((line, index) => (
              <View key={`${index}-${line.description}`} style={styles.row} wrap={false}>
                <Text style={styles.colDesc}>{line.description}</Text>
                <Text style={styles.colQty}>{line.quantity}</Text>
                <Text style={styles.colPrice}>{line.unit_price}</Text>
                <Text style={styles.colTax}>{line.tax}</Text>
                <Text style={styles.colAmount}>{line.amount}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}>
            <Text style={styles.muted}>Subtotal</Text>
            <Text>{totals.subtotal}</Text>
          </View>
          {totals.discount ? (
            <View style={styles.totalRow}>
              <Text style={styles.muted}>Discount</Text>
              <Text>{totals.discount}</Text>
            </View>
          ) : null}
          <View style={styles.totalRow}>
            <Text style={styles.muted}>Tax</Text>
            <Text>{totals.tax}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.muted}>Total</Text>
            <Text>{totals.total}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.muted}>Amount paid</Text>
            <Text>{totals.paid}</Text>
          </View>
          <View style={styles.due}>
            <Text>Amount due</Text>
            <Text>{totals.due}</Text>
          </View>
        </View>

        {data.payments.length > 0 ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>Payments</Text>
            {data.payments.map((payment, index) => (
              <View key={`${index}-${payment.date}`} style={styles.payRow}>
                <Text style={{ width: 90 }}>{payment.date}</Text>
                <Text style={{ width: 110 }}>{payment.method}</Text>
                <Text style={[styles.muted, { flexGrow: 1 }]}>{payment.reference}</Text>
                <Text>{payment.amount}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {data.waysToPay.length > 0 ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>Ways to pay</Text>
            <Text>{data.waysToPay.join(' · ')}</Text>
          </View>
        ) : null}

        {data.payOnline ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>Pay online</Text>
            <Link src={data.payOnline}>{data.payOnline}</Link>
          </View>
        ) : null}

        {data.notes ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          {data.issuedBy.name} · Invoice {data.number}
        </Text>
      </Page>
    </Document>
  );
}
