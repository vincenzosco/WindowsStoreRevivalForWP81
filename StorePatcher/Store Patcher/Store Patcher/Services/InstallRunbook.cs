// The install runbook, for the route that needs no PC.
//
// Measured on this device: the runtime refuses native calls from app code, so this app
// cannot write the certificate store and cannot read it either. What is left is the
// other half of the job, and it is worth doing well: put the install file where the
// phone can reach it, and say exactly what to type into the phone's own console
// (CMD Injector) to import it. The operator stops being the one who has to work out
// the path, the key name and the commands.
//
// Two rules are inherited from the rest of this project:
//   * the file is written from the bytes the desktop generated, never formatted here,
//     so there is one implementation of the .reg layout and it is the verified one;
//   * what was written is read back and compared before it is reported as ready.
//
// The one thing that cannot be established from inside the app is whether that console
// is allowed to read this app's isolated storage. It is not assumed and not claimed:
// step 1 of the runbook is the check that answers it, and the screen says what it means
// when step 1 prints nothing.

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.IsolatedStorage;
using System.Text;

using Store_Patcher.Models;

namespace Store_Patcher.Services
{
    /// <summary>What the runbook managed to do, and the exact steps it prints.</summary>
    public sealed class RunbookResult
    {
        /// <summary>True only when the file was written and read back byte-identical.</summary>
        public bool Written { get; set; }

        /// <summary>File name inside isolated storage.</summary>
        public string FileName { get; set; }

        public int Bytes { get; set; }

        /// <summary>SHA-1 of the file as written, uppercase hex - so a copy can be compared.</summary>
        public string Sha1 { get; set; }

        /// <summary>Why the file is not ready, when it is not.</summary>
        public string Error { get; set; }

        /// <summary>
        /// Where the file is expected to be on the phone's filesystem. This is a
        /// composition from the product id the patch set carries, not a reading: the
        /// runbook says so, and step 1 is what confirms it.
        /// </summary>
        public string ExpectedPath { get; set; }

        /// <summary>The registry key the import creates.</summary>
        public string RegistryKey { get; set; }

        public string Thumbprint { get; set; }

        /// <summary>The line to copy from the screen: the one that is long and typo-prone.</summary>
        public string CopyLine { get; set; }

        /// <summary>The lines to type into the phone's console, in order.</summary>
        public List<string> ConsoleLines { get; set; }

        /// <summary>The whole runbook, as shown on the phone and saved for the PC.</summary>
        public string Text { get; set; }

        /// <summary>True when there is something worth typing into a console.</summary>
        public bool Actionable
        {
            get { return Written && ConsoleLines != null && ConsoleLines.Count > 0; }
        }

        /// <summary>Lines for the report saved on the device, so the PC can read this too.</summary>
        public List<string> Report()
        {
            List<string> lines = new List<string>();
            lines.Add("install runbook: " + (Written ? "ready" : "not ready")
                + (Written
                    ? " - " + FileName + " " + Bytes + " bytes, sha1 " + Sha1
                    : " - " + (Error ?? "no reason given")));

            if (!string.IsNullOrEmpty(ExpectedPath))
            {
                lines.Add("install runbook expected device path (to be confirmed by step 1): " + ExpectedPath);
            }

            if (ConsoleLines != null)
            {
                for (int i = 0; i < ConsoleLines.Count; i++)
                {
                    lines.Add("install runbook step " + (i + 1) + ": " + ConsoleLines[i]);
                }
            }

            return lines;
        }
    }

    public static class InstallRunbook
    {
        /// <summary>Used when the patch set does not name the file itself.</summary>
        public const string DefaultFileName = "install-root-ca.reg";

        /// <summary>
        /// Where a phone keeps an app's files. The product id is appended at run time;
        /// this prefix is the part that is the same on every Windows Phone 8.1 build.
        /// </summary>
        private const string IsolatedStoragePrefix = "C:\\Data\\Users\\DefApps\\APPDATA\\";

        /// <summary>
        /// Folder the console can search without knowing the product id. Left relative to the
        /// drive on purpose: this app cannot know which drive letter the phone's own console
        /// sees, and "from the root of the current drive" is the form that works either way.
        /// </summary>
        private const string SearchRoot = "\\Data\\Users\\DefApps\\APPDATA\\";

        /// <summary>
        /// Write the install file the patch set carries, then report what the phone's own
        /// console has to be told. Never throws: a failure is a result here, and it is
        /// reported with the reason.
        /// </summary>
        public static RunbookResult Prepare(PatchSet set)
        {
            RunbookResult result = new RunbookResult();
            result.ConsoleLines = new List<string>();

            PatchDefinition patch = CertRootOf(set);
            if (patch == null)
            {
                result.Error = "this build carries no cert-root patch, so there is nothing to install";
                result.Text = BuildText(result, null);
                return result;
            }

            result.Thumbprint = patch.Thumbprint;
            result.RegistryKey = "HKLM\\SOFTWARE\\Microsoft\\SystemCertificates\\"
                + (string.IsNullOrEmpty(patch.Store) ? "Root" : patch.Store)
                + "\\Certificates\\" + patch.Thumbprint;

            if (string.IsNullOrEmpty(patch.RegFileBase64))
            {
                // A patch set generated before schema 2 carries the blob but not the file.
                // Saying so is the point: the alternative is a runbook that quietly points
                // at a file nobody wrote.
                result.Error = "this patch set carries no .reg file (schema 1): regenerate it with "
                    + "\"node tools/app.mjs patch\" and deploy the new build";
                result.Text = BuildText(result, patch);
                return result;
            }

            result.FileName = string.IsNullOrEmpty(patch.RegFileName) ? DefaultFileName : patch.RegFileName;

            byte[] file;
            try
            {
                file = Convert.FromBase64String(patch.RegFileBase64);
            }
            catch (Exception ex)
            {
                result.Error = "the .reg carried by the patch set does not decode: " + ex.Message;
                result.Text = BuildText(result, patch);
                return result;
            }

            try
            {
                using (IsolatedStorageFile store = IsolatedStorageFile.GetUserStoreForApplication())
                {
                    using (IsolatedStorageFileStream stream = store.CreateFile(result.FileName))
                    {
                        stream.Write(file, 0, file.Length);
                    }

                    byte[] readBack = ReadAll(store, result.FileName);
                    if (readBack == null || readBack.Length != file.Length || !SameBytes(readBack, file))
                    {
                        result.Error = "the file was written but does not read back identical ("
                            + (readBack == null ? "nothing" : readBack.Length + " bytes") + " vs "
                            + file.Length + " bytes): refusing to call it ready";
                        result.Text = BuildText(result, patch);
                        return result;
                    }
                }

                result.Written = true;
                result.Bytes = file.Length;
                result.Sha1 = CertificateInventory.ThumbprintOf(file);

                string productId = set.App == null ? null : set.App.ProductId;
                if (!string.IsNullOrEmpty(productId))
                {
                    result.ExpectedPath = IsolatedStoragePrefix + productId
                        + "\\Local\\IsolatedStore\\" + result.FileName;
                }

                result.ConsoleLines.Add("dir /s /b " + SearchRoot + result.FileName);
                result.ConsoleLines.Add("reg import \""
                    + (result.ExpectedPath ?? SearchRoot + result.FileName) + "\"");
                result.CopyLine = result.ConsoleLines[1];
            }
            catch (Exception ex)
            {
                result.Error = "could not write " + result.FileName + " into isolated storage: " + ex.Message;
            }

            result.Text = BuildText(result, patch);
            return result;
        }

        // ------------------------------------------------------------------ text

        /// <summary>
        /// The runbook as the operator reads it. Written once here so the screen and the
        /// saved report cannot say different things.
        /// </summary>
        private static string BuildText(RunbookResult result, PatchDefinition patch)
        {
            StringBuilder text = new StringBuilder();

            text.AppendLine("INSTALL THE ROOT CA FROM THE PHONE (no PC)");
            text.AppendLine();

            if (!result.Actionable)
            {
                text.AppendLine("Not available in this build:");
                text.AppendLine("  " + (result.Error ?? "the install file is not ready"));
                text.AppendLine();
                text.AppendLine("Desktop fallback: import ca/install-root-ca.reg into the phone registry");
                text.AppendLine("with WPinternals, reboot, then run the trust check again.");
                return text.ToString();
            }

            text.AppendLine("The install file is on the phone:");
            text.AppendLine("  " + result.FileName + ", " + result.Bytes + " bytes, SHA-1 " + result.Sha1);
            text.AppendLine("  expected path: " + (result.ExpectedPath ?? "not declared by this patch set"));
            text.AppendLine("  (composed from the product id in the patch set - step 1 is what confirms it)");
            text.AppendLine();

            text.AppendLine("In CMD Injector: press Inject, let it reboot, then open it again for the console.");
            text.AppendLine();
            text.AppendLine("STEP 1  find the file");
            text.AppendLine("  " + result.ConsoleLines[0]);
            text.AppendLine("  It prints the full path of the file this app just wrote. The line is relative");
            text.AppendLine("  to the root of whatever drive the console is on: if it prints nothing, try it");
            text.AppendLine("  once more with C: in front. If that prints nothing either, the console cannot");
            text.AppendLine("  read this app's storage - stop here, this route is closed on this phone, and");
            text.AppendLine("  only the desktop fallback remains.");
            text.AppendLine();
            text.AppendLine("STEP 2  import it");
            text.AppendLine("  " + result.ConsoleLines[1]);
            text.AppendLine("  Paste the path step 1 printed in place of the one shown, if it differs.");
            text.AppendLine("  If reg is not recognised on this build, this route is closed too - say so");
            text.AppendLine("  rather than typing the blob by hand.");
            text.AppendLine();
            text.AppendLine("STEP 3  reboot the phone, then open this app again and press");
            text.AppendLine("  \"check lab trust\": a completed TLS handshake to a hijacked name is what");
            text.AppendLine("  proves the CA is trusted. The registry check on the status card cannot");
            text.AppendLine("  prove it - this build refuses native calls from app code - so it reports");
            text.AppendLine("  the refusal instead of an answer.");
            text.AppendLine();
            text.AppendLine("creates: " + (result.RegistryKey ?? "unknown"));
            text.AppendLine();
            text.AppendLine("Before doing this on a Lumia 625: upstream reports that installing CMD");
            text.AppendLine("Injector on this model with WP8.1 Update 2 left every user app unable to");
            text.AppendLine("open, recoverable only through mass storage or a hard reset.");

            return text.ToString();
        }

        // -------------------------------------------------------------- helpers

        private static PatchDefinition CertRootOf(PatchSet set)
        {
            if (set == null || set.Patches == null) return null;

            foreach (PatchDefinition patch in set.Patches)
            {
                if (patch != null && string.Equals(patch.Kind, "cert-root", StringComparison.OrdinalIgnoreCase))
                {
                    return patch;
                }
            }

            return null;
        }

        private static byte[] ReadAll(IsolatedStorageFile store, string path)
        {
            using (IsolatedStorageFileStream stream = store.OpenFile(path, FileMode.Open, FileAccess.Read))
            {
                byte[] buffer = new byte[stream.Length];
                int read = 0;
                while (read < buffer.Length)
                {
                    int step = stream.Read(buffer, read, buffer.Length - read);
                    if (step <= 0) break;
                    read += step;
                }
                if (read == buffer.Length) return buffer;

                byte[] exact = new byte[read];
                Array.Copy(buffer, exact, read);
                return exact;
            }
        }

        private static bool SameBytes(byte[] left, byte[] right)
        {
            if (left == null || right == null) return false;
            if (left.Length != right.Length) return false;
            for (int i = 0; i < left.Length; i++)
            {
                if (left[i] != right[i]) return false;
            }
            return true;
        }
    }
}
