using Store_Patcher.Resources;

namespace Store_Patcher
{
    /// <summary>
    /// Access to the string resources, for XAML bindings that need them.
    /// </summary>
    public class LocalizedStrings
    {
        private static AppResources _localizedResources = new AppResources();

        public AppResources LocalizedResources
        {
            get { return _localizedResources; }
        }
    }
}
