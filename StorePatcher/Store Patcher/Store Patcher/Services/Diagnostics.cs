// Reports written on the device.
//
// Whatever the app finds out about this phone is worth more off the phone: the
// results are saved into isolated storage so they can be retrieved with the
// Isolated Storage Explorer instead of being retyped from the screen.

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.IsolatedStorage;
using System.Text;

namespace Store_Patcher.Services
{
    public static class Diagnostics
    {
        /// <summary>Write lines to a file in isolated storage. Never throws.</summary>
        public static string Save(string fileName, IEnumerable<string> lines)
        {
            try
            {
                using (IsolatedStorageFile store = IsolatedStorageFile.GetUserStoreForApplication())
                using (IsolatedStorageFileStream stream = store.CreateFile(fileName))
                using (StreamWriter writer = new StreamWriter(stream))
                {
                    writer.WriteLine("Store Patcher report, " + DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss") + " UTC");
                    foreach (string line in lines) writer.WriteLine(line);
                }
                return "isolated storage: " + fileName;
            }
            catch (Exception ex)
            {
                return "could not save " + fileName + ": " + ex.Message;
            }
        }
    }
}
