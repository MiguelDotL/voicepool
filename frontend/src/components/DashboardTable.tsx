import type { Account } from "../api";
import AccountRow from "./AccountRow";

interface Props {
  accounts: Account[];
  onDelete: (id: number) => void;
}

const COLUMNS = [
  "Label",
  "Tier",
  "Usage",
  "Characters",
  "Remaining",
  "Reset",
  "Status",
  "",
];

export default function DashboardTable({ accounts, onDelete }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-gray-700">
            {COLUMNS.map((col) => (
              <th
                key={col || "actions"}
                className="py-2 px-4 text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
