// The capability probe.
//
// This is the first thing to run on a phone, and it ships with the app on purpose:
// whether an interop-unlocked Windows Phone 8.1 build lets an app read and write
// HKLM is the one assumption the whole design rests on, and it is not something
// that can be settled from a desktop. The probe answers it with evidence instead
// of a promise.
//
// It only does harmless things: reads two well-known values, writes a four-byte
// test value under its own key and removes it again, and opens the certificate
// store without adding anything. It never restarts the phone.

using System;
using System.Collections.Generic;

using Store_Patcher.Interop;

namespace Store_Patcher.Services
{
    public sealed class ProbeLine
    {
        public string Step { get; set; }
        public bool Ok { get; set; }
        public string Detail { get; set; }

        public string Line
        {
            get
            {
                string text = (Ok ? "PASS  " : "FAIL  ") + Step;
                if (!string.IsNullOrEmpty(Detail)) text += "  - " + Detail;
                return text;
            }
        }
    }

    public sealed class ProbeReport
    {
        public List<ProbeLine> Lines { get; private set; }
        public bool RegistryRead { get; set; }
        public bool RegistryWrite { get; set; }
        public bool CertStoreApi { get; set; }
        public string SavedTo { get; set; }

        public ProbeReport()
        {
            Lines = new List<ProbeLine>();
        }

        /// <summary>True when at least one route for installing the CA exists.</summary>
        public bool CanPatch
        {
            get { return RegistryWrite || CertStoreApi; }
        }
    }

    public static class CapabilityProbe
    {
        private const string ProbeKeyPath = "SOFTWARE\\StorePatcher";
        private const string ProbeValueName = "Probe";

        public static ProbeReport Run()
        {
            ProbeReport report = new ProbeReport();

            ReadWellKnownValues(report);
            WriteTestValue(report);
            ProbeCertificateStore(report);
            NoteReboot(report);

            List<string> lines = new List<string>();
            lines.Add("registry read : " + report.RegistryRead);
            lines.Add("registry write: " + report.RegistryWrite);
            lines.Add("cert store API: " + report.CertStoreApi);
            lines.Add("");
            foreach (ProbeLine line in report.Lines) lines.Add(line.Line);

            if (!report.CanPatch)
            {
                // Measured on the Lumia 625 with this very app: every native call comes
                // back as "DllImport cannot be used on user-defined methods", which is
                // the runtime refusing managed native calls from app code. That is a
                // property of the app model, not a mistake in the patch set, and it
                // changes what the operator should do next.
                lines.Add("");
                lines.Add("No route worked, so the app cannot install the CA itself on this phone.");
                lines.Add("The runtime refuses native calls from app code. Use the desktop path instead:");
                lines.Add("import ca/install-root-ca.reg with WPinternals, or with CMD Injector,");
                lines.Add("then reboot and open this app again to confirm the CA is present.");
            }

            report.SavedTo = Diagnostics.Save("probe.txt", lines);
            return report;
        }

        // --------------------------------------------------------------- steps

        private static void ReadWellKnownValues(ProbeReport report)
        {
            string[][] targets = new string[][]
            {
                new string[] { "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion", "ProductName" },
                new string[] { "SYSTEM\\CurrentControlSet\\Control\\ProductOptions", "ProductType" },
            };

            foreach (string[] target in targets)
            {
                string value;
                NativeResult result = NativeRegistry.ReadString("HKLM", target[0], target[1], out value);

                ProbeLine line = new ProbeLine();
                line.Step = "read HKLM\\" + target[0] + "\\" + target[1];

                if (result.Ok)
                {
                    line.Ok = true;
                    line.Detail = "= \"" + value + "\"";
                    report.RegistryRead = true;
                }
                else
                {
                    line.Ok = false;
                    line.Detail = result.Describe();
                }

                report.Lines.Add(line);
            }
        }

        private static void WriteTestValue(ProbeReport report)
        {
            ProbeLine line = new ProbeLine();
            line.Step = "write, read back and delete a test value under HKLM\\" + ProbeKeyPath;

            IntPtr handle = IntPtr.Zero;
            try
            {
                NativeResult ensured = NativeRegistry.EnsureKey("HKLM", ProbeKeyPath, out handle);
                if (!ensured.Ok)
                {
                    line.Ok = false;
                    line.Detail = "cannot open or create the key: " + ensured.Describe();
                    report.Lines.Add(line);
                    return;
                }

                byte[] expected = new byte[] { 0x53, 0x50, 0x01, 0x00 }; // "SP" + version

                NativeResult written = NativeRegistry.SetBinary(handle, ProbeValueName, expected);
                if (!written.Ok)
                {
                    line.Ok = false;
                    line.Detail = "write refused: " + written.Describe();
                    report.Lines.Add(line);
                    return;
                }

                byte[] actual;
                NativeResult read = NativeRegistry.ReadValue(handle, ProbeValueName, out actual);
                if (!read.Ok)
                {
                    line.Ok = false;
                    line.Detail = "written but not readable back: " + read.Describe();
                    report.Lines.Add(line);
                    return;
                }

                bool identical = actual != null && actual.Length == expected.Length;
                if (identical)
                {
                    for (int i = 0; i < expected.Length; i++)
                    {
                        if (actual[i] != expected[i]) { identical = false; break; }
                    }
                }

                NativeRegistry.DeleteValue(handle, ProbeValueName);

                line.Ok = identical;
                line.Detail = identical
                    ? "value round-tripped byte-identical; the registry route is usable"
                    : "read back " + (actual == null ? "nothing" : actual.Length + " bytes") + ", expected " + expected.Length;
                report.RegistryWrite = identical;
            }
            finally
            {
                NativeRegistry.Close(handle);
            }

            report.Lines.Add(line);
        }

        private static void ProbeCertificateStore(ProbeReport report)
        {
            ProbeLine line = new ProbeLine();
            line.Step = "open the machine Root certificate store (nothing is added)";

            string detail;
            bool ok = CertificateInstaller.Probe(out detail);
            line.Ok = ok;
            line.Detail = detail;
            report.CertStoreApi = ok;
            report.Lines.Add(line);
        }

        private static void NoteReboot(ProbeReport report)
        {
            ProbeLine line = new ProbeLine();
            line.Step = "restart capability";
            line.Ok = true;
            line.Detail = "not probed on purpose - a probe must not restart the phone; "
                + "the Reboot button attempts it and reports what happened";
            report.Lines.Add(line);
        }
    }
}
