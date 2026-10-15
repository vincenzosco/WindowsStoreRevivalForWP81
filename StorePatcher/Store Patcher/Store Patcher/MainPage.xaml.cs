// The app's only screen and its wiring.
//
// The order the buttons are in is the order that makes sense on a device: look,
// then probe, then patch, then reboot. Nothing here decides anything on its own -
// every step reports what it found, including "this does not work on this phone".

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Phone;            // Deployment.Current, for calls that come back off the UI thread
using Microsoft.Phone.Controls;

using Store_Patcher.Models;
using Store_Patcher.Services;

namespace Store_Patcher
{
    public partial class MainPage : PhoneApplicationPage
    {
        private readonly ObservableCollection<string> log = new ObservableCollection<string>();
        private PatchSet patchSet;
        private PatchDefinition primaryPatch;
        private List<CertificateEntry> certificates = new List<CertificateEntry>();
        private RunbookResult runbook;
        private bool runbookPrinted;

        public MainPage()
        {
            InitializeComponent();
            LogList.ItemsSource = log;
            Loaded += OnLoaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            LoadPatchSet();
            CheckDeviceState();

            // The install file is written before the probe runs, because the probe reports
            // the runbook and a runbook that does not exist yet cannot be reported.
            PrepareRunbook();

            // Answer the question that decides everything else on every launch: what
            // is this phone willing to let an app do? It is cheap and it cannot go
            // stale - the first version of this app only did it once and then kept
            // reporting a result that a manifest fix had already invalidated. The
            // report is saved, so it can be read back on the PC with no one holding
            // the phone.
            log.Add("running the capability probe; its report can be read back from the PC");
            RunProbe();
        }

        // ------------------------------------------------------------- actions

        private void OnCheckDevice(object sender, RoutedEventArgs e)
        {
            CheckDeviceState();
        }

        /// <summary>
        /// Open (or close) the certificate and lab details.
        ///
        /// The status line alone says the CA is missing, which is true but not
        /// actionable: what is missing is the thumbprint to import, the address that
        /// has to answer for the Store names, and the names themselves.
        /// </summary>
        private void OnStatusTapped(object sender, System.Windows.Input.MouseButtonEventArgs e)
        {
            bool opening = DetailsPanel.Visibility != Visibility.Visible;
            DetailsPanel.Visibility = opening ? Visibility.Visible : Visibility.Collapsed;
            TapHint.Text = opening ? "tap to hide the details" : "tap for certificate and lab details";

            if (opening)
            {
                DetailsText.Text = BuildDetails();
                LoadCertificates();
            }
        }

        /// <summary>
        /// Fill the selection list with every authority this phone is being offered.
        ///
        /// Selecting one is the point of the screen: the status line says the CA is
        /// missing, and the answer to "which CA, and which DNS" is one tap away.
        /// </summary>
        private void LoadCertificates()
        {
            certificates = CertificateInventory.List(patchSet);
            CertificateList.ItemsSource = null;
            CertificateList.ItemsSource = certificates;

            if (certificates.Count > 0)
            {
                // Select the first entry without going through the event: the list is
                // rebuilt every time the panel opens, and doing it here keeps the
                // detail text and the highlighted row from ever disagreeing.
                CertificateList.SelectedIndex = 0;
                CertificateDetail.Text = certificates[0].Describe();
            }
            else
            {
                CertificateDetail.Text = "No certificate authority is offered by this build: the\n"
                    + "patch set carries none, and nothing was pushed into isolated storage.";
            }
        }

        private void OnCertificateSelected(object sender, SelectionChangedEventArgs e)
        {
            CertificateEntry entry = CertificateList.SelectedItem as CertificateEntry;
            if (entry == null) return;
            CertificateDetail.Text = entry.Describe();
        }

        private string BuildDetails()
        {
            if (primaryPatch == null)
            {
                return "No patch set is embedded in this build, so there is no certificate or lab address to show.";
            }

            LabInfo lab = patchSet == null ? null : patchSet.Lab;
            string address = lab == null || string.IsNullOrEmpty(lab.AdvertiseIp)
                ? "not set in this build"
                : lab.AdvertiseIp;

            StringBuilder text = new StringBuilder();

            text.AppendLine("LAB DNS: " + address);
            text.AppendLine("set it in Wi-Fi -> advanced -> DNS, then reconnect");
            text.AppendLine();

            text.AppendLine("ROOT CA SHA-1: " + primaryPatch.Thumbprint);
            text.AppendLine("registry: " + primaryPatch.Hive
                + "\\SOFTWARE\\Microsoft\\SystemCertificates\\" + primaryPatch.Store
                + "\\Certificates\\" + primaryPatch.Thumbprint);
            text.AppendLine();

            if (lab != null && lab.Hosts != null && lab.Hosts.Count > 0)
            {
                text.AppendLine("THE LAB ANSWERS FOR " + lab.Hosts.Count + " NAME(S):");
                foreach (string host in lab.Hosts)
                {
                    text.AppendLine("  " + host);
                }
            }
            else
            {
                text.AppendLine("The lab name list is not in this patch set.");
            }

            text.AppendLine();
            if (runbook != null)
            {
                text.AppendLine("install file: " + (runbook.Actionable
                    ? runbook.FileName + " ready on the phone, " + runbook.Bytes + " bytes, SHA-1 " + runbook.Sha1
                    : "not ready - " + (runbook.Error ?? "no reason given")));
                text.AppendLine();
            }

            text.AppendLine("This build cannot write the registry or the certificate store: the");
            text.AppendLine("runtime refuses native calls from app code, which the capability probe");
            text.AppendLine("reports with the exact error - and for the same reason it cannot read the");
            text.AppendLine("store to check whether the CA is there. What it can do is put the install");
            text.AppendLine("file on the phone and print the line that imports it: press \"how to");
            text.AppendLine("install it here\".");
            text.AppendLine();
            text.AppendLine("To find out whether the CA is trusted, press \"check lab trust\": a completed");
            text.AppendLine("TLS handshake to a hijacked name is the proof, and it needs no capability.");
            text.AppendLine();
            text.AppendLine("Select an authority below to see the DNS address it belongs to and the");
            text.AppendLine("names that address is meant to answer for.");

            return text.ToString();
        }

        private void OnProbe(object sender, RoutedEventArgs e)
        {
            RunProbe();
        }

        /// <summary>Runs the probe and reports it. Shared by the button and the first launch.</summary>
        private void RunProbe()
        {
            log.Add("--- capability probe ---");

            ProbeReport report = CapabilityProbe.Run(runbook);
            foreach (ProbeLine line in report.Lines)
            {
                log.Add(line.Line);
            }
            log.Add("saved: " + report.SavedTo);
            log.Add(report.CanPatch
                ? "at least one route for installing the CA works on this phone"
                : "no route worked: fall back to ca/install-root-ca.reg (WPinternals or CMD Injector)");
        }

        /// <summary>
        /// Write the install file onto the phone and keep the lines the console needs.
        ///
        /// This is the half of the job that is left to this app: it cannot write the
        /// certificate store, but it can prepare the install file and say exactly what to
        /// type on the phone to import it - no cable, no PC.
        /// </summary>
        private void PrepareRunbook()
        {
            runbook = null;
            runbookPrinted = false;
            CopyButton.IsEnabled = false;

            if (patchSet == null)
            {
                RunbookButton.IsEnabled = false;
                return;
            }

            runbook = InstallRunbook.Prepare(patchSet);

            if (runbook.Actionable)
            {
                log.Add("install runbook ready: " + runbook.FileName + " (" + runbook.Bytes
                    + " bytes, SHA-1 " + runbook.Sha1 + ") - press \"how to install it here\"");
                CopyButton.IsEnabled = true;
            }
            else
            {
                log.Add("FAIL  install runbook not ready: " + (runbook.Error ?? "no reason given"));
            }

            log.Add("saved: " + Diagnostics.Save("runbook.txt", runbook.Report()));
        }

        /// <summary>
        /// Show the runbook. It goes into the log rather than into a panel of its own: the
        /// log is the surface on this screen that already scrolls.
        /// </summary>
        private void OnRunbook(object sender, RoutedEventArgs e)
        {
            if (runbook == null)
            {
                log.Add("no runbook: this build carries no patch set to build one from");
                return;
            }

            if (runbookPrinted)
            {
                log.Add("--- the runbook is already above, and saved in runbook.txt ---");
                return;
            }

            runbookPrinted = true;
            log.Add("--- install runbook ---");
            foreach (string line in runbook.Text.Split(new char[] { '\r', '\n' }, StringSplitOptions.None))
            {
                log.Add(line);
            }
        }

        /// <summary>
        /// Copy the line that is long enough to be mistyped. The clipboard API may not be
        /// on this build: if it is not, that is reported instead of pretended.
        /// </summary>
        private void OnCopyImportLine(object sender, RoutedEventArgs e)
        {
            if (runbook == null || string.IsNullOrEmpty(runbook.CopyLine))
            {
                log.Add("nothing to copy: the runbook is not ready");
                return;
            }

            try
            {
                Clipboard.SetText(runbook.CopyLine);
                log.Add("copied to the clipboard: " + runbook.CopyLine);
            }
            catch (Exception ex)
            {
                log.Add("FAIL  could not copy to the clipboard: " + ex.GetType().Name + ": " + ex.Message);
                log.Add("type it instead: " + runbook.CopyLine);
            }
        }

        /// <summary>
        /// Ask the phone, over TLS, whether it trusts the lab.
        ///
        /// This is the check the rest of the screen leans on: the registry read above cannot
        /// work on this build, so "is the CA installed" has to be answered by using it.
        /// </summary>
        private void OnTrust(object sender, RoutedEventArgs e)
        {
            List<string> hosts = LabTrustProbe.Hosts(patchSet);
            if (hosts.Count == 0)
            {
                TrustText.Text = "lab trust: nothing to test - this patch set carries no host names";
                log.Add("FAIL  the patch set carries no host names, so there is nothing to test");
                return;
            }

            log.Add("--- lab trust over TLS, " + hosts.Count + " name(s) ---");
            log.Add("the phone must be on the lab's network, with Wi-Fi DNS pointing at the lab");

            TrustButton.IsEnabled = false;
            TrustText.Text = "lab trust: checking " + hosts.Count + " name(s)...";

            LabTrustProbe.Check(
                hosts,
                delegate(TrustResult result) { OnUi(delegate { log.Add(result.Line); }); },
                delegate(List<TrustResult> results) { OnUi(delegate { FinishTrust(results); }); });
        }

        /// <summary>
        /// The probe answers from a worker thread, so everything that touches the screen
        /// goes through the dispatcher: touching it directly is a cross-thread failure.
        /// </summary>
        private void OnUi(Action action)
        {
            Deployment.Current.Dispatcher.BeginInvoke(action);
        }

        private void FinishTrust(List<TrustResult> results)
        {
            string address = patchSet == null || patchSet.Lab == null ? null : patchSet.Lab.AdvertiseIp;
            string summary = LabTrustProbe.Summarize(results, address);

            TrustText.Text = "lab trust: " + summary;
            log.Add(summary);

            List<string> lines = new List<string>();
            lines.Add("lab address in this build: " + (string.IsNullOrEmpty(address) ? "not set" : address));
            foreach (TrustResult result in results) lines.Add(result.Line);
            lines.Add(summary);
            log.Add("saved: " + Diagnostics.Save("trust.txt", lines));

            TrustButton.IsEnabled = true;
        }

        private void OnApply(object sender, RoutedEventArgs e)
        {
            if (patchSet == null || patchSet.Patches.Count == 0)
            {
                log.Add("FAIL  nothing to apply: this build carries no patch set");
                return;
            }

            log.Add("--- applying " + patchSet.Patches.Count + " patch(es) ---");

            PatchRun run = PatchEngine.Apply(patchSet);
            foreach (PatchResult result in run.Results)
            {
                log.Add(result.Line);
            }
            log.Add("saved: " + run.SavedTo);

            if (run.RebootRequired)
            {
                RebootText.Visibility = Visibility.Visible;
                RebootButton.IsEnabled = true;
                log.Add("REBOOT REQUIRED  the trusted root store is read while the phone boots");
            }
            else
            {
                log.Add("no reboot needed: nothing was written, or what was needed was already in place");
            }

            CheckDeviceState();
        }

        private void OnReboot(object sender, RoutedEventArgs e)
        {
            log.Add("--- reboot attempt ---");

            RebootAttempt attempt = RebootService.TryReboot();
            log.Add((attempt.Accepted ? "ACCEPTED  " : "REFUSED  ") + attempt.Route + "  " + attempt.Detail);

            if (!attempt.Accepted)
            {
                log.Add("restart the phone by hand: hold the power button and swipe down");
            }
        }

        // -------------------------------------------------------------- state

        private void LoadPatchSet()
        {
            try
            {
                patchSet = PatchSetLoader.Load();
                primaryPatch = patchSet.Patches.Count > 0 ? patchSet.Patches[0] : null;

                StatusText.Text = string.Format(
                    "{0} patch(es), generated {1}, lab {2}",
                    patchSet.Patches.Count,
                    string.IsNullOrEmpty(patchSet.GeneratedAt) ? "unknown" : patchSet.GeneratedAt,
                    patchSet.Lab == null || string.IsNullOrEmpty(patchSet.Lab.AdvertiseIp)
                        ? "not set"
                        : patchSet.Lab.AdvertiseIp);

                ApplyButton.IsEnabled = primaryPatch != null;
            }
            catch (Exception ex)
            {
                patchSet = null;
                primaryPatch = null;
                ApplyButton.IsEnabled = false;
                StatusText.Text = "no patch set embedded in this build";
                log.Add("FAIL  " + ex.Message);
            }
        }

        private void CheckDeviceState()
        {
            if (primaryPatch == null)
            {
                StateText.Text = "root CA on device: unknown (no patch set)";
                return;
            }

            string detail;
            bool present = PatchEngine.IsAlreadyPresent(primaryPatch, out detail);
            StateText.Text = "root CA in the device store: " + (present ? "present" : "not present")
                + "  (" + detail + ")";
        }
    }
}
