// Application entry point.
//
// Only what the app needs: the root frame, the language setup that the resource
// file drives, and a place where an unhandled exception is recorded instead of
// silently closing the app - on a device with no debugger attached, that record is
// the difference between a diagnosable failure and "it closed".

using System;
using System.Windows;
using System.Windows.Markup;
using System.Windows.Navigation;
using Microsoft.Phone.Controls;
using Microsoft.Phone.Shell;
using Store_Patcher.Resources;

namespace Store_Patcher
{
    public partial class App : Application
    {
        /// <summary>Root frame of the phone application.</summary>
        public static PhoneApplicationFrame RootFrame { get; private set; }

        public App()
        {
            UnhandledException += Application_UnhandledException;

            InitializeComponent();
            InitializePhoneApplication();
            InitializeLanguage();
        }

        private void Application_ContractActivated(object sender, Windows.ApplicationModel.Activation.IActivatedEventArgs e)
        {
        }

        // Runs when the application starts (for example from Start).
        private void Application_Launching(object sender, LaunchingEventArgs e)
        {
        }

        // Runs when the application is brought to the foreground.
        private void Application_Activated(object sender, ActivatedEventArgs e)
        {
        }

        // Runs when the application is sent to the background.
        private void Application_Deactivated(object sender, DeactivatedEventArgs e)
        {
        }

        // Runs when the application is closed (for example with Back).
        private void Application_Closing(object sender, ClosingEventArgs e)
        {
        }

        private void RootFrame_NavigationFailed(object sender, NavigationFailedEventArgs e)
        {
            if (System.Diagnostics.Debugger.IsAttached)
            {
                System.Diagnostics.Debugger.Break();
            }
        }

        /// <summary>
        /// Record an unhandled exception rather than losing it.
        ///
        /// The report goes to isolated storage, so a failure on the phone can be read
        /// back on the PC even when there is no debugger around.
        /// </summary>
        private void Application_UnhandledException(object sender, ApplicationUnhandledExceptionEventArgs e)
        {
            string message = e.ExceptionObject == null ? "(no exception object)" : e.ExceptionObject.ToString();
            Services.Diagnostics.Save("crash.txt", new string[] { message });

            if (System.Diagnostics.Debugger.IsAttached)
            {
                System.Diagnostics.Debugger.Break();
            }
        }

        #region Phone application initialisation

        private bool phoneApplicationInitialized = false;

        private void InitializePhoneApplication()
        {
            if (phoneApplicationInitialized)
            {
                return;
            }

            // Create the frame but do not set it as RootVisual yet: the splash screen
            // stays up until the application is ready to render.
            RootFrame = new PhoneApplicationFrame();
            RootFrame.Navigated += CompleteInitializePhoneApplication;
            RootFrame.NavigationFailed += RootFrame_NavigationFailed;
            RootFrame.Navigated += CheckForResetNavigation;

            PhoneApplicationService.Current.ContractActivated += Application_ContractActivated;

            phoneApplicationInitialized = true;
        }

        private void CompleteInitializePhoneApplication(object sender, NavigationEventArgs e)
        {
            if (RootVisual != RootFrame)
            {
                RootVisual = RootFrame;
            }

            RootFrame.Navigated -= CompleteInitializePhoneApplication;
        }

        private void CheckForResetNavigation(object sender, NavigationEventArgs e)
        {
            if (e.NavigationMode == NavigationMode.Reset)
            {
                RootFrame.Navigated += ClearBackStackAfterReset;
            }
        }

        private void ClearBackStackAfterReset(object sender, NavigationEventArgs e)
        {
            RootFrame.Navigated -= ClearBackStackAfterReset;

            if (e.NavigationMode != NavigationMode.New && e.NavigationMode != NavigationMode.Refresh)
            {
                return;
            }

            while (RootFrame.RemoveBackEntry() != null)
            {
                // nothing to do
            }
        }

        #endregion

        /// <summary>
        /// Apply the font and flow direction declared by the neutral resource file,
        /// so the UI matches the language this build ships with.
        /// </summary>
        private void InitializeLanguage()
        {
            try
            {
                RootFrame.Language = XmlLanguage.GetLanguage(AppResources.ResourceLanguage);

                FlowDirection flow = (FlowDirection)Enum.Parse(
                    typeof(FlowDirection), AppResources.ResourceFlowDirection);

                RootFrame.FlowDirection = flow;
            }
            catch (Exception)
            {
                if (System.Diagnostics.Debugger.IsAttached)
                {
                    System.Diagnostics.Debugger.Break();
                }

                throw;
            }
        }
    }
}
