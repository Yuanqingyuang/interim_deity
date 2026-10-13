using System;
using System.IO;
using System.Text;
using InterimDeity.Core;

namespace InterimDeity.Save
{
    public sealed class SaveService
    {
        public const string SlotFileName = "slot1.json";
        private const string TempSuffix = ".tmp";

        private readonly string _slotPath;

        public SaveService(string slotPath)
        {
            if (string.IsNullOrEmpty(slotPath)) throw new ArgumentException("slotPath 不能为空", nameof(slotPath));
            _slotPath = slotPath;
        }

        public static SaveService ForDirectory(string directory)
        {
            if (string.IsNullOrEmpty(directory)) throw new ArgumentException("directory 不能为空", nameof(directory));
            return new SaveService(Path.Combine(directory, SlotFileName));
        }

        public string SlotPath => _slotPath;

        public bool Exists => File.Exists(_slotPath);

        public bool TrySave(WorldState G, bool paused, out string error)
        {
            error = null;
            if (G == null) { error = "世界状态为空"; return false; }
            string json;
            try
            {
                json = SaveCodec.Serialize(SaveCodec.Capture(G, paused));
            }
            catch (Exception ex)
            {
                error = "序列化失败：" + ex.Message;
                return false;
            }
            return TryWrite(json, out error);
        }

        public bool TryWrite(string json, out string error)
        {
            error = null;
            if (json == null) { error = "存档内容为空"; return false; }

            WorldState probe;
            bool probePaused;
            string verr;
            if (!SaveCodec.TryLoadWorld(json, out probe, out probePaused, out verr))
            {
                error = "存档校验失败：" + verr;
                return false;
            }

            string tmp = _slotPath + TempSuffix;
            try
            {
                string dir = Path.GetDirectoryName(_slotPath);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);

                using (var fs = new FileStream(tmp, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var w = new StreamWriter(fs, new UTF8Encoding(false)))
                {
                    w.Write(json);
                    w.Flush();
                    fs.Flush(true);
                }

                string onDisk = File.ReadAllText(tmp, Encoding.UTF8);
                if (!SaveCodec.TryLoadWorld(onDisk, out probe, out probePaused, out verr))
                {
                    SafeDelete(tmp);
                    error = "写入校验失败：" + verr;
                    return false;
                }

                if (File.Exists(_slotPath)) File.Replace(tmp, _slotPath, null);
                else File.Move(tmp, _slotPath);
                return true;
            }
            catch (Exception ex)
            {
                SafeDelete(tmp);
                error = "写盘失败：" + ex.Message;
                return false;
            }
        }

        public bool TryLoad(out WorldState G, out bool paused, out string error)
        {
            G = null;
            paused = false;
            error = null;
            string json;
            if (!TryReadJson(out json, out error)) return false;
            return SaveCodec.TryLoadWorld(json, out G, out paused, out error);
        }

        public bool TryReadJson(out string json, out string error)
        {
            json = null;
            error = null;
            if (!File.Exists(_slotPath)) { error = "存档不存在"; return false; }
            try
            {
                json = File.ReadAllText(_slotPath, Encoding.UTF8);
                return true;
            }
            catch (Exception ex)
            {
                error = "读取失败：" + ex.Message;
                return false;
            }
        }

        public bool TryDelete(out string error)
        {
            error = null;
            try
            {
                SafeDelete(_slotPath + TempSuffix);
                if (File.Exists(_slotPath)) File.Delete(_slotPath);
                return true;
            }
            catch (Exception ex)
            {
                error = "删除失败：" + ex.Message;
                return false;
            }
        }

        private static void SafeDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); }
            catch { }
        }
    }
}
