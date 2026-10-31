# Canonical business rules

Operating conventions **2026-10-26.1**. Module policies precede intermodule workflows. See [Business terms](business_terms.md) for entities and roles, and [Appendix A](#appendix-a-notation) for notation.

## Module specifications

### Customers

#### Invariants

**CUS-001. Account boundary.** Settlement and credit funding cannot cross customer accounts.

### Catalog

#### Domain policies

**CAT-002. Commercial snapshot.** Ordinary creation and editing use the agreed price and current catalog points rate. Additional dispatched goods use **WF-004**.

### Orders

#### Invariants

**ORD-001. Demand partition.** For each current commercial line, open demand $U_l$ satisfies:

$$
Q_l=C_l+S_l+U_l,\qquad C_l,S_l,U_l\geq0,\qquad 0\leq L_l\leq U_l.
$$

#### Domain policies

**ORD-003. Ordinary edit boundary.** An ordinary edit is permitted only before any dispatch or cancellation.

**ORD-004. Cancellation scope.** With a reason, cancel selected unshipped demand or all open demand when no selection is supplied. At least one unit must be canceled.

#### Transitions

**ORD-005. Commercial lifecycle.** Editing appends a revision. Review applies to the current revision only. Rejection and editing require a reason.

| Operation | Starting condition                                      | Result                                                                                                         |
| --------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Create    | New order                                               | `DRAFT`.                                                                                                       |
| Edit      | ORD-003; previously `APPROVED` or `REAPPROVAL_REQUIRED` | Next revision; `REAPPROVAL_REQUIRED`.                                                                          |
| Edit      | ORD-003; any other permitted status                     | Next revision; `DRAFT`.                                                                                        |
| Submit    | `DRAFT` or `REJECTED`                                   | `PENDING`.                                                                                                     |
| Submit    | `REAPPROVAL_REQUIRED`                                   | Remain `REAPPROVAL_REQUIRED`.                                                                                  |
| Approve   | `PENDING` or `REAPPROVAL_REQUIRED`                      | Record approval; `APPROVED`.                                                                                   |
| Reject    | `PENDING` or `REAPPROVAL_REQUIRED`                      | Record rejection; `REJECTED`.                                                                                  |
| Cancel    | ORD-004                                                 | Append cancellations, $C'_l=C_l+q_l$. Set `CANCELLED` only if all units are canceled and none were dispatched. |

**ORD-006. Loading withdrawal.** An ordinary edit or effective cancellation voids **all** loading batches of the order.

![Commercial lifecycle diagram](diagrams/order-lifecycle.svg)

### Fulfillment

#### Invariants

**FUL-001. Physical quantity bounds.** Apply these bounds separately to each shipment line:

$$
0\leq r_h\leq d_h\leq s_h.
$$

#### Domain policies

**FUL-003. Loading and dispatch gate.** Loading and dispatch require the order to be `APPROVED` for the current revision. Dispatch also requires the loading document to name that revision.

#### Transitions

**FUL-004. Loading.** A new `LOADING` batch reserves selected open units.

**FUL-005. Dispatch.** Dispatch a whole `LOADING` batch. Its loaded units become dispatched units, its reservation ends, and its status becomes `DISPATCHED`.

**FUL-006. Delivery.** Confirm quantities only on a `DISPATCHED` batch; set it to `DELIVERED` when all dispatched units are confirmed. A delivery correction (**FUL-007**) returns a `DELIVERED` batch to `DISPATCHED`.

**FUL-007. Delivery correction.** A KAM or Admin may lower an overstated confirmed count on a `DISPATCHED` or `DELIVERED` batch, giving a reason and evidence. For each corrected shipment line the new total $d'_h$ must satisfy

$$
r_h\leq d'_h<d_h.
$$

The removed units return to dispatched, in transit; $s_h$ and order demand do not change, and later confirmations follow **FUL-006**. Reverse confirmations latest first, each with a linked negative entry (**WF-001**), and reduce each confirmation's charge by a linked adjustment of $-q\,p_h$. Release settlement above the reduced charge in **WF-003** order. Released cash stays free: nothing was returned, so no credit note is created. Then apply **WF-002**.

![Shipment lifecycle diagram](diagrams/shipment-lifecycle.svg)

### Returns

#### Domain policies

**RET-001. Return source.** A physical return identifies delivered shipment lines and a reason. It is recorded when goods are received back.

**RET-002. Return valuation.** Value returns at shipment-line prices, with an explicitly chosen deduction $\phi$:

$$
g=\sum_h q_hp_h,\qquad 0\leq\phi\leq g.
$$

### Accounts

#### Invariants

**ACC-001. Charge capacity.** For each charge, settlements and the remaining obligation are nonnegative:

$$
v_j,c_j,k_j,z_j\geq0,\qquad b_j=v_j-c_j-k_j-z_j\geq0.
$$

**ACC-002. Receipt capacity.** Receipt value is either allocated, reserved as credit funding, or free:

$$
a_i,f_i\geq0,\qquad u_i=m_i-a_i-f_i\geq0.
$$

#### Domain policies

**ACC-003. Cash priority.** Allocate free cash across the customer's outstanding charges in creation-time order, breaking ties by recording order. Visit receipts in that same ordering. Each allocation takes:

$$
x=\min(u_i,b_j).
$$

### Credits

#### Invariants

**CRD-001. Funded credit capacity.** Let $f_{ni}$ be the amount of receipt $i$ reserved for note $n$. Every credit note is fully receipt-backed, and applications and refunds remain within its issued value:

$$
I_n=\sum_i f_{ni},\qquad K_n,F_n\geq0,\qquad O_n=I_n-K_n-F_n\geq0.
$$

Net refunds attributed to a note/receipt pair cannot exceed that pair's funding.

#### Domain policies

**CRD-002. Explicit issue.** Reserve only free cash. Choose receipts in recording order until the requested issue amount is funded.

**CRD-003. Application.** Apply credit explicitly to a selected charge.

**CRD-004. Refund.** Record a refund against open credit, with a bank reference. Split it across the note's funding receipts in funding-record order, within each receipt's unrefunded funding capacity.

**CRD-005. Reversal limits.** A reversal names a positive original entry and a reason; refund reversal also records a bank reference. Let $w_e$ be that entry's amount less its linked reversals, and $K_{nj}$ the net credit still applied between its note and charge:

$$
\begin{aligned}
\text{Application reversal: }&0<x\leq\min(w_e,K_{nj}),\\
\text{Refund reversal: }&0<x\leq w_e.
\end{aligned}
$$

#### Transitions

**CRD-006. Credit movements.** Issuance requires a reason. Funding remains reserved after application or refund. Reversal appends a linked negative entry against the same sources; reverse split refunds per original entry.

![Credit movement diagram](diagrams/credit-movements.svg)

### Rewards

#### Domain policies

**REW-001. Retained entitlement.** Commercial approval establishes entitlement at the commercial line's recorded points rate:

$$
E_l=\begin{cases}
(Q_l-C_l-R_l)\rho_l,&\text{order status is APPROVED},\\
0,&\text{otherwise}.
\end{cases}
$$

**REW-002. Cash qualification.** Earn points from net cash applied to goods charges, using the current commercial line's recorded price and points rate. Round down **per charge**, then cap at retained entitlement:

$$
e_l=\min\left(E_l,\sum_{j\in\operatorname{goods}(l)}
\left\lfloor\frac{c_j\rho_l}{p_l}\right\rfloor\right).
$$

**REW-003. Bucket policy.** Unearned entitlement stays locked. Earned points are spendable after subtracting net redemptions. Any shortfall becomes clawback pending and absorbs later earnings before points become spendable.

**REW-004. Redemption.** One point settles one paise of a selected charge. Redemption is permitted only with no pending clawback:

$$
\mathrm{ClawbackPending}=0,\qquad
0<x\leq\min(\mathrm{Available},b_j).
$$

![Reward dependency diagram](diagrams/reward-dependencies.svg)

## Intermodule and workflow logic

### Invariants

**WF-001. Business history.** Preserve commercial revisions, confirmed dispatches and deliveries, returns, receipts, and posted financial/reward entries. Changes to posted value use linked additions or compensating entries.

### Domain policies

**WF-002. Cash allocation occasions.** Apply **ACC-003** after payment receipt, delivery confirmation, additional-goods correction, delivery correction (**FUL-007**), and completed return settlement, or on explicit allocation. Other operations do not trigger cash allocation.

### Transitions

**WF-003. Return settlement.** Reduce each returned shipment line's goods charges in recording order by its gross returned value. Release settlement exceeding retained charge value: cash, then credit, then points. Within cash or credit, visit source groups in reverse order of their first allocation/application. Restore each released amount to its original source.

Record the deduction as a separate fee charge. Apply released cash to that fee first, in the order the receipt sources were first encountered during release. Reserve any remaining released cash as a new receipt-backed credit note. Then apply **WF-002**.

**WF-004. Additional dispatched goods.** Require an existing dispatch, reason, evidence, and authorization reference. Identify the additional goods' dispatch: an existing dispatch of this order or a separate dispatch with its actual time, no later than the present.

For added quantity $q$, record a new approved revision and a dispatched supplement; delivered quantity $d$ satisfies $0\leq d\leq q$. Retained SKUs keep their commercial price and points rate; new SKUs use the supplied price and current catalog rate. Supplement lines use the current catalog points rate.

Void all loading batches. Link the supplement to the identified existing dispatch and retain its time, or use the separate dispatch's actual time. Recognize supplied deliveries under **WF-005**; later confirmations follow **FUL-006**.

**WF-005. Delivery recognition.** Recognize goods value only on confirmed delivery. Each confirmation creates exactly one goods charge at the shipment-line price:

$$
\operatorname{value}(\operatorname{charge}(e))=q_ep_h,
\qquad \#\operatorname{charges}(e)=1.
$$

A delivery correction (**FUL-007**) keeps the charge and adds one linked adjustment per reversed confirmation; the reversal entry carries exactly one such adjustment of $q_ep_h$ with $q_e<0$.

![Return settlement flow](diagrams/return-settlement.svg)

## Appendix A. Notation

### Conventions

Money is in integer INR paise; quantities and points are integers. An operation quantity or amount is positive unless explicitly permitted to be zero.

A prime denotes the resulting value. Posting totals include signed reversals. Recording order is the order in which facts were recorded.

### Symbols

| Symbol                | Business fact                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------- |
| $l,h,j,i,n$           | Commercial line, shipment line, charge, receipt, credit note.                                |
| $Q_l,C_l,S_l,R_l,L_l$ | Ordered, canceled, dispatched, returned, and currently loading units of a commercial line.   |
| $s_h,d_h,r_h$         | Dispatched, gross delivered, and returned units of a shipment line.                          |
| $p_l,\rho_l,p_h$      | Agreed commercial price, commercial points per unit, and shipment-line price.                |
| $v_j,c_j,k_j,z_j,b_j$ | Retained charge value, cash applied, credit applied, points applied, and outstanding amount. |
| $m_i,a_i,f_i,u_i$     | Receipt amount, net cash allocated, credit funding reserved, and free cash.                  |
| $I_n,K_n,F_n,O_n$     | Issued credit, net applications, net refunds, and open credit.                               |

### Quantity and value definitions

| Term                       | Definition                                             |
| -------------------------- | ------------------------------------------------------ |
| Commercial physical totals | Sum of the corresponding shipment-line facts.          |
| Currently loading units    | Units reserved by batches still `LOADING`.             |
| Retained charge value      | Original charge plus its signed adjustments.           |
| Receipt funding            | Sum of the receipt's reservations across credit notes. |

## Related

- [Business guide](README.md)
- [Business terms](business_terms.md)
- [Business reference](../business-terms.md)
- [API reference](../api.md)
- [Backend module responsibilities](../../server/src/README.md)
- [Verification](../verification.md)
