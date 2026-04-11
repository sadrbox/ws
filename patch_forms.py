"""Patch all Form components with useAccessRight"""
import re
import os

MODELS_DIR = r"w:\app\frontend\src\models"

# Map: folder name -> Prisma model name
FOLDER_TO_MODEL = {
    "AccessRights": "AccessRight",
    "Todos": "Todo",
    "ActivityHistories": "ActivityHistory",
    "Contacts": "Contact",
    "ScheduledTasks": "ScheduledTask",
    "Users": "User",
    "BankAccounts": "BankAccount",
    "Brands": "Brand",
    "CashExpenseOrders": "CashExpenseOrder",
    "CashReceiptOrders": "CashReceiptOrder",
    "ContactPersons": "ContactPerson",
    "ContactTypes": "ContactType",
    "Contracts": "Contract",
    "Counterparties": "Counterparty",
    "Currencies": "Currency",
    "Employees": "Employee",
    "IncomingInvoices": "IncomingInvoice",
    "InventoryTransfers": "InventoryTransfer",
    "OutgoingInvoices": "OutgoingInvoice",
    "PaymentInvoices": "PaymentInvoice",
    "Positions": "Position",
    "Products": "Product",
    "Purchases": "Purchase",
    "Sales": "Sale",
    "Warehouses": "Warehouse",
}

# Skip Organizations (already done)
SKIP = {"Organizations"}

patched = []
skipped = []
errors = []

for folder, model_name in FOLDER_TO_MODEL.items():
    if folder in SKIP:
        skipped.append(folder)
        continue

    filepath = os.path.join(MODELS_DIR, folder, "index.tsx")
    if not os.path.exists(filepath):
        errors.append(f"{folder}: file not found")
        continue

    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    # Check if already patched
    if "useAccessRight" in content:
        skipped.append(f"{folder} (already has useAccessRight)")
        continue

    original = content

    # 1. Add import after FormPanel import
    import_line = 'import FormPanel from "src/components/FormPanel";'
    if import_line not in content:
        errors.append(f"{folder}: FormPanel import not found")
        continue

    content = content.replace(
        import_line,
        import_line + '\nimport { useAccessRight } from "src/hooks/useAccessRight";',
        1
    )

    # 2. Find the Form component and add useAccessRight after uuid line
    # Look for "const uuid = data?.uuid" line after any Form component declaration
    uuid_line = "  const uuid = data?.uuid as string | undefined;"
    if uuid_line in content:
        content = content.replace(
            uuid_line,
            uuid_line + f'\n  const {{ canWrite }} = useAccessRight("{model_name}");',
            1
        )
    else:
        errors.append(f"{folder}: uuid line not found in Form component")
        content = original
        continue

    # 3. Add readonly={!canWrite} to <FormPanel
    # Handle both inline and multi-line FormPanel
    # Inline: <FormPanel onSaveAndClose={...} ... />
    # Multi-line: <FormPanel\n  onSaveAndClose={...}
    
    if "<FormPanel\n" in content:
        # Multi-line: <FormPanel\n        onSaveAndClose=...
        content = content.replace("<FormPanel\n", "<FormPanel\n        readonly={!canWrite}\n", 1)
    elif "<FormPanel onSaveAndClose=" in content:
        content = content.replace("<FormPanel onSaveAndClose=", "<FormPanel readonly={!canWrite} onSaveAndClose=", 1)
    elif "<FormPanel onClose=" in content:
        content = content.replace("<FormPanel onClose=", "<FormPanel readonly={!canWrite} onClose=", 1)
    else:
        errors.append(f"{folder}: <FormPanel usage pattern not found")
        content = original
        continue

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)

    patched.append(folder)

print(f"\n=== PATCHED ({len(patched)}) ===")
for p in patched:
    print(f"  ✓ {p}")

print(f"\n=== SKIPPED ({len(skipped)}) ===")
for s in skipped:
    print(f"  - {s}")

print(f"\n=== ERRORS ({len(errors)}) ===")
for e in errors:
    print(f"  ✗ {e}")
