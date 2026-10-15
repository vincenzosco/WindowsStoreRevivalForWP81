// Which certificate authorities this phone is being offered, and where each one
// points the Store.
//
// Tapping the status card answers "the root CA is not present" with the one thing
// that makes it actionable: *which* authority, and *which* address answers for the
// names the Store asks for. There are two sources, and they are kept separate on
// purpose:
//
//   1. the patch set embedded in this XAP - the lab's own CA, whose address is
//      whatever the lab advertised when the build was generated;
//   2. files placed in isolated storage under `certificates/`, which is how a
//      second authority can be compared against the first without rebuilding the
//      app. The desktop side puts them there with `node tools/app.mjs push-ca`.
//
// An address is never invented. A CA either carries one - from the patch set, or
// from a `lab.txt` file next to it - or the screen says it does not declare one.
// Guessing here would send someone to configure the wrong DNS and then wonder why
// the Store still fails.

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.IsolatedStorage;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

using Store_Patcher.Models;

namespace Store_Patcher.Services
{
    /// <summary>One certificate authority, as it can be shown and selected on screen.</summary>
    public sealed class CertificateEntry
    {
        /// <summary>Stable identity for selection: thumbprint when it could be computed.</summary>
        public string Id { get; set; }

        /// <summary>Where this entry came from, in words an operator can act on.</summary>
        public string Source { get; set; }

        /// <summary>File name inside isolated storage, or null for the embedded patch set CA.</summary>
        public string FileName { get; set; }

        public byte[] Der { get; set; }

        public string Subject { get; set; }
        public string Issuer { get; set; }
        public string NotAfter { get; set; }

        /// <summary>SHA-1, uppercase hex - the same form the registry key and the patch set use.</summary>
        public string Thumbprint { get; set; }

        /// <summary>The DNS address this CA belongs to, or null when none is declared.</summary>
        public string DnsAddress { get; set; }

        /// <summary>Where the address came from: "patch set", "lab.txt", or nothing.</summary>
        public string DnsSource { get; set; }

        /// <summary>Names the address is meant to answer for.</summary>
        public List<string> Hosts { get; set; }

        /// <summary>True for the CA embedded in the patch set.</summary>
        public bool IsLabCertificate { get; set; }

        /// <summary>True when the bytes are identical to the lab CA, not merely similar.</summary>
        public bool IdenticalToLab { get; set; }

        /// <summary>Set when the file could not be read as a certificate.</summary>
        public string Error { get; set; }

        public CertificateEntry()
        {
            Hosts = new List<string>();
        }

        /// <summary>One line for the selection list.</summary>
        public string Caption
        {
            get
            {
                if (!string.IsNullOrEmpty(Error)) return "unreadable: " + FileName;

                string where = IsLabCertificate ? "patch set" : FileName;
                string address = string.IsNullOrEmpty(DnsAddress) ? "no DNS declared" : DnsAddress;
                return Short(Subject) + "  (" + where + ")  ->  " + address;
            }
        }

        /// <summary>The detail block shown for the selected authority.</summary>
        public string Describe()
        {
            if (!string.IsNullOrEmpty(Error))
            {
                return "FILE: " + FileName + "\r\n"
                    + "This file could not be read as a certificate: " + Error + "\r\n"
                    + "Put a DER or PEM encoded certificate in isolated storage\\"
                    + CertificateInventory.DirectoryName + "\\ and push it again.";
            }

            StringBuilder text = new StringBuilder();

            text.AppendLine("SELECTED AUTHORITY");
            text.AppendLine("  " + Short(Subject));
            text.AppendLine("  from: " + Source);
            text.AppendLine();

            text.AppendLine("DNS ADDRESS: " + (string.IsNullOrEmpty(DnsAddress) ? "not declared" : DnsAddress));
            text.AppendLine("  " + (DnsSource ?? "no source"));
            if (!string.IsNullOrEmpty(DnsAddress))
            {
                text.AppendLine("  set it in Wi-Fi -> advanced -> DNS, then reconnect");
            }
            text.AppendLine();

            if (Hosts != null && Hosts.Count > 0)
            {
                text.AppendLine("ANSWERS FOR " + Hosts.Count + " NAME(S):");
                foreach (string host in Hosts) text.AppendLine("  " + host);
                text.AppendLine();
            }

            text.AppendLine("SHA-1: " + Thumbprint);
            text.AppendLine("issuer: " + Short(Issuer));
            if (!string.IsNullOrEmpty(NotAfter)) text.AppendLine("expires: " + NotAfter);
            text.AppendLine();

            text.AppendLine("registry key this authority occupies when trusted:");
            text.AppendLine("  HKLM\\SOFTWARE\\Microsoft\\SystemCertificates\\Root\\Certificates\\" + Thumbprint);
            text.AppendLine();

            if (IsLabCertificate)
            {
                text.AppendLine("This is the authority the lab is serving right now. Import");
                text.AppendLine("ca/install-root-ca.reg with WPinternals, reboot, then check");
                text.AppendLine("the status line above.");
            }
            else if (IdenticalToLab)
            {
                text.AppendLine("IDENTICAL to the lab CA: same bytes, so importing either one is");
                text.AppendLine("the same act, and the DNS above applies.");
            }
            else
            {
                text.AppendLine("DIFFERENT from the lab CA: this is a separate authority, so the");
                text.AppendLine("lab's certificate is not interchangeable with it. Only trust it if");
                text.AppendLine("you also point this phone's DNS at the address above.");
            }

            return text.ToString();
        }

        private static string Short(string value)
        {
            if (string.IsNullOrEmpty(value)) return "(no name)";
            string text = value.Replace("\r", " ").Replace("\n", " ").Trim();
            return text.Length <= 90 ? text : text.Substring(0, 87) + "...";
        }
    }

    public static class CertificateInventory
    {
        /// <summary>Folder in isolated storage the desktop side pushes certificates into.</summary>
        public const string DirectoryName = "certificates";

        /// <summary>Companion file that declares the DNS address a certificate belongs to.</summary>
        public const string DnsFileName = "lab.txt";

        private static readonly string[] CertificateExtensions = new string[] { ".cer", ".crt", ".der", ".pem", ".cert" };

        /// <summary>
        /// Every authority this phone can be shown: the embedded one first, then
        /// whatever was pushed into isolated storage. Never throws - a file that
        /// cannot be read becomes an entry that says so.
        /// </summary>
        public static List<CertificateEntry> List(PatchSet set)
        {
            List<CertificateEntry> entries = new List<CertificateEntry>();

            CertificateEntry lab = FromPatchSet(set);
            if (lab != null) entries.Add(lab);

            entries.AddRange(FromIsolatedStorage());

            foreach (CertificateEntry entry in entries)
            {
                if (lab == null || lab.Der == null || entry.Der == null) continue;
                entry.IdenticalToLab = SameBytes(entry.Der, lab.Der);
            }

            return entries;
        }

        /// <summary>
        /// The CA the patch set carries. Its address travels with it, so this entry is
        /// the only one that always knows where it points.
        /// </summary>
        private static CertificateEntry FromPatchSet(PatchSet set)
        {
            if (set == null || set.Patches == null) return null;

            PatchDefinition patch = null;
            foreach (PatchDefinition candidate in set.Patches)
            {
                if (candidate != null && string.Equals(candidate.Kind, "cert-root", StringComparison.OrdinalIgnoreCase))
                {
                    patch = candidate;
                    break;
                }
            }
            if (patch == null || string.IsNullOrEmpty(patch.DerBase64)) return null;

            byte[] der;
            try
            {
                der = Convert.FromBase64String(patch.DerBase64);
            }
            catch (Exception)
            {
                return null;
            }

            CertificateEntry entry = new CertificateEntry();
            entry.IsLabCertificate = true;
            entry.Source = "patches.json, embedded in this build";
            entry.Der = der;
            entry.FileName = null;

            // The thumbprint in the patch set was computed on the PC and is what the
            // registry key must be named. Prefer it over a local recomputation so the
            // two can never disagree on screen.
            entry.Thumbprint = string.IsNullOrEmpty(patch.Thumbprint)
                ? ThumbprintOf(der)
                : patch.Thumbprint;

            LabInfo lab = set.Lab;
            if (lab != null)
            {
                entry.DnsAddress = string.IsNullOrEmpty(lab.AdvertiseIp) ? null : lab.AdvertiseIp;
                entry.DnsSource = string.IsNullOrEmpty(lab.AdvertiseIp)
                    ? "the patch set carries no lab address: regenerate it with node tools/app.mjs patch"
                    : "advertised by the patch set (lab.advertiseIp)";
                if (lab.Hosts != null) entry.Hosts.AddRange(lab.Hosts);
            }

            Describe(entry);
            return entry;
        }

        /// <summary>Certificates pushed into isolated storage, each with its companion DNS file.</summary>
        private static List<CertificateEntry> FromIsolatedStorage()
        {
            List<CertificateEntry> entries = new List<CertificateEntry>();

            try
            {
                using (IsolatedStorageFile store = IsolatedStorageFile.GetUserStoreForApplication())
                {
                    if (!store.DirectoryExists(DirectoryName))
                    {
                        // Nothing pushed yet. Report it as a fact, not as an error: the
                        // picker is still useful with just the patch set CA in it.
                        return entries;
                    }

                    string[] files = store.GetFileNames(DirectoryName + "\\*");
                    Array.Sort(files, StringComparer.OrdinalIgnoreCase);

                    foreach (string name in files)
                    {
                        if (!LooksLikeCertificate(name)) continue;

                        CertificateEntry entry = new CertificateEntry();
                        entry.FileName = name;
                        entry.Source = "isolated storage\\" + DirectoryName + "\\" + name;

                        try
                        {
                            byte[] raw = ReadAll(store, DirectoryName + "\\" + name);
                            string decodeError;
                            byte[] der = TryDecode(raw, out decodeError);
                            entry.Error = decodeError;

                            if (der != null)
                            {
                                entry.Der = der;
                                entry.Thumbprint = ThumbprintOf(der);
                                Describe(entry);
                            }
                        }
                        catch (Exception ex)
                        {
                            entry.Error = ex.Message;
                        }

                        ApplyDns(store, entry);
                        entries.Add(entry);
                    }
                }
            }
            catch (Exception)
            {
                // No isolated storage, or it is unreadable: the patch set entry stands.
            }

            return entries;
        }

        /// <summary>
        /// Read the address this certificate belongs to, from `lab.txt` in the same
        /// folder: first non-empty line is the address, the rest are host names.
        /// </summary>
        private static void ApplyDns(IsolatedStorageFile store, CertificateEntry entry)
        {
            try
            {
                if (store.FileExists(DirectoryName + "\\" + DnsFileName))
                {
                    string[] lines = ReadAllText(store, DirectoryName + "\\" + DnsFileName)
                        .Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);

                    foreach (string raw in lines)
                    {
                        string line = raw.Trim();
                        if (line.Length == 0 || line.StartsWith("#")) continue;

                        if (string.IsNullOrEmpty(entry.DnsAddress))
                        {
                            entry.DnsAddress = line;
                            entry.DnsSource = "declared in " + DirectoryName + "\\" + DnsFileName
                                + " (pushed by node tools/app.mjs push-ca --dns)";
                        }
                        else
                        {
                            entry.Hosts.Add(line);
                        }
                    }
                }
            }
            catch (Exception)
            {
                // An unreadable companion file must not hide the certificate itself.
            }

            if (string.IsNullOrEmpty(entry.DnsAddress))
            {
                entry.DnsSource = "no address declared for this file: push one with "
                    + "node tools/app.mjs push-ca <file> --dns <address>";
            }
        }

        /// <summary>Fill in subject, issuer and expiry once the bytes are known to be a certificate.</summary>
        private static void Describe(CertificateEntry entry)
        {
            try
            {
                X509Certificate certificate = new X509Certificate(entry.Der);
                entry.Subject = certificate.Subject;
                entry.Issuer = certificate.Issuer;
                entry.NotAfter = certificate.GetExpirationDateString();
            }
            catch (Exception ex)
            {
                entry.Subject = null;
                entry.Issuer = null;
                if (string.IsNullOrEmpty(entry.Error)) entry.Error = "read as a certificate: " + ex.Message;
            }
        }

        /// <summary>
        /// Accept DER as-is and unwrap a PEM wrapper when present, because both are
        /// what people actually have on disk.
        /// </summary>
        private static byte[] TryDecode(byte[] raw, out string error)
        {
            error = null;
            if (raw == null || raw.Length == 0)
            {
                error = "empty file";
                return null;
            }

            // DER: a SEQUENCE always starts with 0x30.
            if (raw[0] == 0x30) return raw;

            try
            {
                string text = Encoding.UTF8.GetString(raw, 0, raw.Length);
                int begin = text.IndexOf("-----BEGIN CERTIFICATE-----", StringComparison.Ordinal);
                if (begin < 0)
                {
                    error = "not DER and not a PEM certificate";
                    return null;
                }

                int end = text.IndexOf("-----END CERTIFICATE-----", begin, StringComparison.Ordinal);
                string body = end < 0
                    ? text.Substring(begin + 27)
                    : text.Substring(begin + 27, end - (begin + 27));

                byte[] der = Convert.FromBase64String(body.Replace("\r", string.Empty).Replace("\n", string.Empty).Trim());
                if (der.Length == 0 || der[0] != 0x30)
                {
                    error = "the PEM body did not decode to a DER certificate";
                    return null;
                }
                return der;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return null;
            }
        }

        private static bool LooksLikeCertificate(string name)
        {
            string lower = name.ToLowerInvariant();
            foreach (string extension in CertificateExtensions)
            {
                if (lower.EndsWith(extension)) return true;
            }
            return false;
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

        private static string ReadAllText(IsolatedStorageFile store, string path)
        {
            byte[] bytes = ReadAll(store, path);
            return Encoding.UTF8.GetString(bytes, 0, bytes.Length);
        }

        /// <summary>SHA-1 of the encoded certificate, uppercase hex, no separators.</summary>
        public static string ThumbprintOf(byte[] der)
        {
            // SHA1.Create() is not part of the Windows Phone surface; the managed
            // implementation is. Both compute the same SHA-1 the registry key uses.
            using (SHA1 sha = new SHA1Managed())
            {
                byte[] hash = sha.ComputeHash(der);
                StringBuilder text = new StringBuilder(hash.Length * 2);
                foreach (byte b in hash) text.Append(b.ToString("X2"));
                return text.ToString();
            }
        }

        /// <summary>Lines describing the inventory, for the report saved on the device.</summary>
        public static List<string> Report(List<CertificateEntry> entries)
        {
            List<string> lines = new List<string>();
            lines.Add("certificate authorities offered: " + entries.Count);

            foreach (CertificateEntry entry in entries)
            {
                string where = entry.IsLabCertificate ? "patch set" : entry.FileName;
                string address = string.IsNullOrEmpty(entry.DnsAddress) ? "no DNS declared" : entry.DnsAddress;
                lines.Add("  " + where + "  sha1 " + (entry.Thumbprint ?? "unknown")
                    + "  dns " + address + (entry.Error == null ? string.Empty : "  error " + entry.Error));
            }

            return lines;
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
