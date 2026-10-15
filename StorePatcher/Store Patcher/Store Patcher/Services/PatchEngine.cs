// The patch engine.
//
// Rules it follows, in order of importance:
//   1. never claim more than was verified - what was written is read back and
//      compared before a patch is reported as applied;
//   2. never write what is already there - a byte-identical value is reported as
//      already present, which also proves the patch survived a reboot;
//   3. never stop at the first failure - the remaining patches are still tried,
//      because the fallback channel is chosen per patch.

using System;
using System.Collections.Generic;
using System.Text;

using Store_Patcher.Interop;
using Store_Patcher.Models;

namespace Store_Patcher.Services
{
    public sealed class PatchRun
    {
        public List<PatchResult> Results { get; private set; }

        /// <summary>True when at least one patch was written and needs a reboot to be read at boot.</summary>
        public bool RebootRequired { get; set; }

        public string SavedTo { get; set; }

        public PatchRun()
        {
            Results = new List<PatchResult>();
        }

        public int CountWith(PatchStatus status)
        {
            int count = 0;
            foreach (PatchResult result in Results)
            {
                if (result.Status == status) count++;
            }
            return count;
        }
    }

    public static class PatchEngine
    {
        private const string CertificatesRoot = "SOFTWARE\\Microsoft\\SystemCertificates\\";
        private const string BlobValueName = "Blob";

        public static PatchRun Apply(PatchSet set)
        {
            PatchRun run = new PatchRun();

            if (set == null || set.Patches == null)
            {
                run.SavedTo = Diagnostics.Save("patches.txt", new string[] { "the patch set is empty" });
                return run;
            }

            List<string> lines = new List<string>();

            foreach (PatchDefinition patch in set.Patches)
            {
                PatchResult result = ApplyOne(patch);
                run.Results.Add(result);
                lines.Add(result.Line);

                if (result.RequiresReboot && result.Status == PatchStatus.Applied)
                {
                    run.RebootRequired = true;
                }
            }

            lines.Add("");
            lines.Add("reboot required: " + run.RebootRequired);
            run.SavedTo = Diagnostics.Save("patches.txt", lines);
            return run;
        }

        public static PatchResult ApplyOne(PatchDefinition patch)
        {
            PatchResult result = PatchResult.Create(
                patch == null ? "(null)" : patch.Id,
                patch == null ? null : patch.Description);

            if (patch == null)
            {
                result.Status = PatchStatus.Skipped;
                result.Detail = "empty patch entry";
                return result;
            }

            string kind = (patch.Kind ?? string.Empty).ToLowerInvariant();

            switch (kind)
            {
                case "cert-root":
                    return ApplyCertRoot(patch, result);

                default:
                    // A patch set from a newer lab may contain kinds this build does
                    // not know. Skipping keeps the rest of the run useful.
                    result.Status = PatchStatus.Skipped;
                    result.Detail = "unknown kind \"" + patch.Kind + "\" - rebuild the app with a newer tools/app.mjs";
                    return result;
            }
        }

        // ------------------------------------------------------------ cert-root

        private static PatchResult ApplyCertRoot(PatchDefinition patch, PatchResult result)
        {
            byte[] blob;
            try
            {
                blob = Convert.FromBase64String(patch.BlobBase64);
            }
            catch (Exception ex)
            {
                result.Status = PatchStatus.Failed;
                result.Detail = "the patch set carries an unreadable blob: " + ex.Message;
                return result;
            }

            string keyPath = CertificatesRoot + patch.Store + "\\Certificates\\" + patch.Thumbprint;

            // 1. Is it already there, byte-identical?
            byte[] existing;
            NativeResult readExisting = ReadBlob(patch.Hive, keyPath, out existing);
            if (readExisting.Ok && SameBytes(existing, blob))
            {
                result.Status = PatchStatus.AlreadyPresent;
                result.Route = "registry";
                result.Detail = "the thumbprint is already trusted and the value is byte-identical"
                    + " - nothing written, so it already survived a reboot";
                result.RequiresReboot = false;
                return result;
            }

            bool hadDifferentValue = readExisting.Ok;
            string mismatch = hadDifferentValue
                ? "a different value was present and replaced"
                : "nothing was present";

            StringBuilder failures = new StringBuilder();

            // 2. Certificate store API, then verify through the registry: on Windows
            //    the system store *is* the registry, so the read-back is the proof.
            byte[] der = null;
            try
            {
                der = Convert.FromBase64String(patch.DerBase64);
            }
            catch (Exception ex)
            {
                failures.Append("no DER in the patch set (" + ex.Message + "); ");
            }

            if (der != null)
            {
                string storeError;
                if (CertificateInstaller.TryAddToMachineRoot(der, out storeError))
                {
                    byte[] verify;
                    NativeResult verified = ReadBlob(patch.Hive, keyPath, out verify);
                    if (verified.Ok && SameBytes(verify, blob))
                    {
                        result.Status = hadDifferentValue ? PatchStatus.Replaced : PatchStatus.Applied;
                        result.Route = "cert-store-api";
                        result.Detail = "installed through the certificate store API and verified in the registry: " + mismatch;
                        result.RequiresReboot = patch.RequiresReboot;
                        return result;
                    }
                    failures.Append("certificate store API accepted it but the registry does not show it ("
                        + (verified.Ok ? "different value" : verified.Describe()) + "); ");
                }
                else
                {
                    failures.Append(storeError + "; ");
                }
            }

            // 3. Write the verified blob ourselves.
            NativeResult write = WriteBlob(patch.Hive, keyPath, blob);
            if (!write.Ok)
            {
                failures.Append("registry write: " + write.Describe());
                result.Status = PatchStatus.Failed;
                result.Detail = failures.ToString();
                return result;
            }

            byte[] written;
            NativeResult readBack = ReadBlob(patch.Hive, keyPath, out written);
            if (readBack.Ok && SameBytes(written, blob))
            {
                result.Status = hadDifferentValue ? PatchStatus.Replaced : PatchStatus.Applied;
                result.Route = "registry";
                result.Detail = "written and read back byte-identical: " + mismatch;
                result.RequiresReboot = patch.RequiresReboot;
                return result;
            }

            failures.Append("written but the read-back does not match ("
                + (readBack.Ok ? "different bytes" : readBack.Describe()) + ")");
            result.Status = PatchStatus.Failed;
            result.Detail = failures.ToString();
            return result;
        }

        /// <summary>Read-only check used by the status screen.</summary>
        public static bool IsAlreadyPresent(PatchDefinition patch, out string detail)
        {
            detail = null;
            if (patch == null || string.IsNullOrEmpty(patch.Thumbprint))
            {
                detail = "no thumbprint in the patch set";
                return false;
            }

            byte[] blob;
            try
            {
                blob = Convert.FromBase64String(patch.BlobBase64);
            }
            catch (Exception ex)
            {
                detail = "unreadable blob: " + ex.Message;
                return false;
            }

            string keyPath = CertificatesRoot + patch.Store + "\\Certificates\\" + patch.Thumbprint;
            byte[] existing;
            NativeResult read = ReadBlob(patch.Hive, keyPath, out existing);

            if (!read.Ok)
            {
                detail = "not present (" + read.Describe() + ")";
                return false;
            }

            bool same = SameBytes(existing, blob);
            detail = same
                ? "present and byte-identical"
                : "present with different bytes (" + (existing == null ? 0 : existing.Length) + " vs " + blob.Length + ")";
            return same;
        }

        // ------------------------------------------------------------ registry

        private static NativeResult ReadBlob(string hive, string keyPath, out byte[] value)
        {
            value = null;
            IntPtr handle = IntPtr.Zero;

            try
            {
                NativeResult opened = NativeRegistry.OpenKey(hive, keyPath, false, out handle);
                if (!opened.Ok) return opened;

                return NativeRegistry.ReadValue(handle, BlobValueName, out value);
            }
            finally
            {
                NativeRegistry.Close(handle);
            }
        }

        private static NativeResult WriteBlob(string hive, string keyPath, byte[] blob)
        {
            IntPtr handle = IntPtr.Zero;

            try
            {
                NativeResult ensured = EnsureKeyPath(hive, keyPath, out handle);
                if (!ensured.Ok) return ensured;

                return NativeRegistry.SetBinary(handle, BlobValueName, blob);
            }
            finally
            {
                NativeRegistry.Close(handle);
            }
        }

        /// <summary>
        /// Create the key and any missing parent along the way: NtCreateKey only
        /// creates the last component, and a phone that has never had a third-party
        /// certificate in the store has no "Certificates" parent yet.
        /// </summary>
        private static NativeResult EnsureKeyPath(string hive, string keyPath, out IntPtr handle)
        {
            handle = IntPtr.Zero;

            string[] parts = keyPath.Split(new char[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
            string current = string.Empty;

            for (int i = 0; i < parts.Length; i++)
            {
                current = i == 0 ? parts[i] : current + "\\" + parts[i];

                bool isLast = i == parts.Length - 1;
                NativeResult step = isLast
                    ? NativeRegistry.EnsureKey(hive, current, out handle)
                    : EnsureKeyTransient(hive, current);

                if (!step.Ok) return step;
            }

            return NativeResult.Success();
        }

        private static NativeResult EnsureKeyTransient(string hive, string keyPath)
        {
            IntPtr handle = IntPtr.Zero;
            try
            {
                return NativeRegistry.EnsureKey(hive, keyPath, out handle);
            }
            finally
            {
                NativeRegistry.Close(handle);
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
