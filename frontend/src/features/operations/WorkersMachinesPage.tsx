import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client.ts";
import {
  createMachine,
  createWorker,
  fetchMachines,
  fetchWorkers,
  updateMachine,
  updateWorker,
} from "../../api/operations.ts";
import type {
  EmploymentStatus,
  MachineRecord,
  WorkerRecord,
} from "../../types/operations.ts";

export function WorkersMachinesPage() {
  const [tab, setTab] = useState<"workers" | "machines">("workers");
  const [workers, setWorkers] = useState<WorkerRecord[]>([]);
  const [machines, setMachines] = useState<MachineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // New worker form
  const [workerCode, setWorkerCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("");
  const [joinedDate, setJoinedDate] = useState("");

  // New machine form
  const [machineCode, setMachineCode] = useState("");
  const [machineName, setMachineName] = useState("");
  const [machineType, setMachineType] = useState("CRUSHER");
  const [machineDesc, setMachineDesc] = useState("");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, m] = await Promise.all([
        fetchWorkers(true),
        fetchMachines(true),
      ]);
      setWorkers(w);
      setMachines(m);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load directory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleAddWorker(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await createWorker({
        workerCode: workerCode.trim(),
        fullName: fullName.trim(),
        phone: phone.trim() || null,
        designation: designation.trim(),
        joinedDate: joinedDate.trim() || null,
        employmentStatus: "ACTIVE",
      });
      setWorkerCode("");
      setFullName("");
      setPhone("");
      setDesignation("");
      setJoinedDate("");
      setNotice(`Worker ${created.fullName} (${created.workerCode}) added.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add worker.");
    }
  }

  async function handleWorkerStatus(w: WorkerRecord, status: EmploymentStatus) {
    setError(null);
    try {
      await updateWorker(w.id, {
        fullName: w.fullName,
        phone: w.phone,
        designation: w.designation,
        joinedDate: w.joinedDate,
        employmentStatus: status,
        notes: w.notes,
      });
      setNotice(`${w.fullName} marked ${status}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update worker.");
    }
  }

  async function handleAddMachine(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await createMachine({
        machineCode: machineCode.trim(),
        machineName: machineName.trim(),
        machineType: machineType.trim(),
        description: machineDesc.trim() || null,
        isActive: true,
      });
      setMachineCode("");
      setMachineName("");
      setMachineDesc("");
      setNotice(`Machine ${created.machineName} (${created.machineCode}) added.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add machine.");
    }
  }

  async function handleToggleMachine(m: MachineRecord) {
    setError(null);
    try {
      await updateMachine(m.id, {
        machineName: m.machineName,
        machineType: m.machineType,
        description: m.description,
        isActive: !m.isActive,
      });
      setNotice(`${m.machineName} marked ${!m.isActive ? "Active" : "Inactive"}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update machine.");
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] p-4 md:p-8 lg:p-10">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.12em] text-[#f58220]">
            Workshop Master Directory
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-[#092547] md:text-3xl">
            Workers &amp; Machines
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Maintain active quarry workers, crusher units, and heavy machinery used across daily operation logs.
          </p>
        </div>
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
          <button
            type="button"
            onClick={() => setTab("workers")}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${
              tab === "workers"
                ? "bg-[#092547] text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Workers ({workers.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("machines")}
            className={`rounded-lg px-4 py-2 text-xs font-bold ${
              tab === "machines"
                ? "bg-[#092547] text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Machines ({machines.length})
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-700">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          {notice}
        </div>
      )}

      {tab === "workers" ? (
        <div className="space-y-6">
          <form
            onSubmit={handleAddWorker}
            className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-6"
          >
            <input
              type="text"
              required
              placeholder="Code (e.g. WRK-01)"
              value={workerCode}
              onChange={(e) => setWorkerCode(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              placeholder="Full Name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              placeholder="Designation (e.g. Operator)"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="Phone (Optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={joinedDate}
              onChange={(e) => setJoinedDate(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#f58220] px-4 py-2 text-sm font-bold text-white hover:bg-[#df7318]"
            >
              Add Worker
            </button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Code</th>
                  <th className="px-5 py-3">Name</th>
                  <th className="px-5 py-3">Designation</th>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Change Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      Loading workers...
                    </td>
                  </tr>
                ) : (
                  workers.map((w) => (
                    <tr key={w.id}>
                      <td className="px-5 py-3 font-mono text-xs font-bold">{w.workerCode}</td>
                      <td className="px-5 py-3 font-bold text-[#092547]">{w.fullName}</td>
                      <td className="px-5 py-3 text-slate-600">{w.designation}</td>
                      <td className="px-5 py-3 text-slate-600">{w.phone ?? "-"}</td>
                      <td className="px-5 py-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                          {w.employmentStatus}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <select
                          aria-label={`Status for ${w.fullName}`}
                          value={w.employmentStatus}
                          onChange={(e) =>
                            void handleWorkerStatus(w, e.target.value as EmploymentStatus)
                          }
                          className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold"
                        >
                          <option value="ACTIVE">ACTIVE</option>
                          <option value="ON_LEAVE">ON_LEAVE</option>
                          <option value="INACTIVE">INACTIVE</option>
                        </select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <form
            onSubmit={handleAddMachine}
            className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
          >
            <input
              type="text"
              required
              placeholder="Code (e.g. JAW-01)"
              value={machineCode}
              onChange={(e) => setMachineCode(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              placeholder="Machine Name"
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={machineType}
              onChange={(e) => setMachineType(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="CRUSHER">CRUSHER</option>
              <option value="SCREEN">SCREEN</option>
              <option value="LOADER">LOADER</option>
              <option value="EXCAVATOR">EXCAVATOR</option>
              <option value="GENERATOR">GENERATOR</option>
              <option value="OTHER">OTHER</option>
            </select>
            <input
              type="text"
              placeholder="Notes (Optional)"
              value={machineDesc}
              onChange={(e) => setMachineDesc(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-xl bg-[#f58220] px-4 py-2 text-sm font-bold text-white hover:bg-[#df7318]"
            >
              Add Machine
            </button>
          </form>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Code</th>
                  <th className="px-5 py-3">Machine Name</th>
                  <th className="px-5 py-3">Type</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                      Loading machines...
                    </td>
                  </tr>
                ) : (
                  machines.map((m) => (
                    <tr key={m.id}>
                      <td className="px-5 py-3 font-mono text-xs font-bold">{m.machineCode}</td>
                      <td className="px-5 py-3 font-bold text-[#092547]">{m.machineName}</td>
                      <td className="px-5 py-3 text-slate-600">{m.machineType}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            m.isActive
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {m.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleToggleMachine(m)}
                          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-bold text-[#092547] hover:bg-slate-50"
                        >
                          {m.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

